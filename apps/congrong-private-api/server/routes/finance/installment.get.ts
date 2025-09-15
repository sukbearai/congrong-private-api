/**
 * 分期金融计算接口（GET）
 * 路由: GET /api/finance/installment
 *
 * 说明：
 * - 给定分期总额、期数和“等价无息贷款”的现值（pv），求解隐含月贴现率 i（即月度IRR）
 * - 计算有效年化收益率 EAR = (1 + i)^12 - 1
 * - 计算分期现金流的现值（按解出的 i 折现）；当为“即付年金”（含当月）时，会乘 (1 + i)
 *
 * 示例（题述）：
 * - total=5999, months=24, pv=5099, due=true（含当月，年金先付）
 * - 月供 A = 5999 / 24
 * - 解得 i ≈ 0.014684，EAR ≈ 19.12%
 *
 * 查询参数：
 * - total: 分期总额（如 5999）
 * - months: 期数（如 24）
 * - pv: 等价现值（如 5099，代表你“相当于拿到的无息贷款”的现值）
 * - due: 是否为“含当月/先付”年金，true/false，默认 true
 * - monthly: 可选，月供（若不传则按 total/months 计算）
 * - precision: 可选，小数精度，默认 6
 */
export default defineEventHandler(async (event) => {
  try {
  // 使用 Formula.js 的财务函数（RATE/PV），并在必要时回退到当前的二分法求解
  // 说明：Formula.js 要求现金流符号相反（pv 与 pmt 方向相反），且 type=1 表示先付（含当月）
  const { RATE, PV } = await import('@formulajs/formulajs')

    const query = getQuery(event)

    // 使用 zod 做参数校验与转换（项目中已全局可用）
    const schema = z.object({
      total: z.union([z.string(), z.number()]).transform(v => Number(v)),
      months: z.union([z.string(), z.number()]).transform(v => Number.parseInt(String(v), 10)),
      pv: z.union([z.string(), z.number()]).transform(v => Number(v)),
      due: z.union([z.string(), z.boolean()]).optional()
        .transform(v => v === undefined ? true : (v === true || v === 'true' || v === '1')),
      monthly: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? undefined : Number(v)),
      precision: z.union([z.string(), z.number()]).optional().transform(v => v === undefined ? 6 : Number(v)),
    })

    const parsed = schema.safeParse(query)
    if (!parsed.success) {
      const errorMessages = parsed.error.errors.map(e => e.message).join('; ')
      return createErrorResponse(errorMessages, 400)
    }

    const { total, months, pv, due, monthly: monthlyMaybe, precision } = parsed.data

    if (!(months > 0)) return createErrorResponse('months 必须为正整数', 400)
    if (!(total > 0)) return createErrorResponse('total 必须大于 0', 400)
    if (!(pv > 0)) return createErrorResponse('pv 必须大于 0', 400)

    const monthly = monthlyMaybe !== undefined ? monthlyMaybe : total / months

    // PV 计算（普通年金与即付年金）
    const pvAnnuity = (i: number, n: number, A: number, isDue: boolean): number => {
      if (n <= 0) return 0
      if (i === 0) return A * n // 极限情形
      const pvOrd = A * (1 - Math.pow(1 + i, -n)) / i
      return isDue ? pvOrd * (1 + i) : pvOrd
    }

  // 求解 i：使得 pvAnnuity(i, months, monthly, due) = pv
    const f = (i: number) => pvAnnuity(i, months, monthly, due ?? true) - pv

    // 先用区间扩张 + 二分法（稳健）
  const solveRate = (): number => {
      let lo = 0
      let hi = 1 // 初始上界：100% 月利率
      let fLo = f(0)
      let fHi = f(hi)

      // 若在 hi=1 仍未变号，则逐步扩张上界（最多扩到 1000 倍）
      let expandCount = 0
      while (fLo * fHi > 0 && hi < 1000 && expandCount < 60) {
        hi *= 2
        fHi = f(hi)
        expandCount++
      }

      if (fLo === 0) return 0
      if (fHi === 0) return hi
      if (fLo * fHi > 0) {
        // 仍无变号：用一个小的数值方法兜底（牛顿法/割线法），这里退回到近似法
        // 若 pv 接近总额，则 i 近 0；否则给出业务错误提示
        return 0
      }

      // 二分
      for (let iter = 0; iter < 200; iter++) {
        const mid = (lo + hi) / 2
        const fMid = f(mid)
        if (Math.abs(fMid) < 1e-12) return mid
        if (fLo * fMid <= 0) {
          hi = mid
          fHi = fMid
        }
        else {
          lo = mid
          fLo = fMid
        }
      }
      return (lo + hi) / 2
    }

    // 优先用 Formula.js 的 RATE，失败则回退到本地二分法
    const solveRateWithFormulaJS = (): number => {
      const type = (due ?? true) ? 1 : 0
      const guesses = [0.01, 0.001, 0.02, 0.05, 0.1]
      for (const guess of guesses) {
        try {
          // 注意：pmt 为支出（负数），pv 为流入（正数）
          const r = RATE(months, -monthly, pv, 0, type, guess as number)
          if (typeof r === 'number' && Number.isFinite(r) && r > -0.9999 && r < 10) return r
        }
        catch {}
      }
      return Number.NaN
    }

    let monthlyRate = solveRateWithFormulaJS()
    if (!Number.isFinite(monthlyRate) || monthlyRate < 0) monthlyRate = solveRate()

  const ear = Math.pow(1 + monthlyRate, 12) - 1
    // 用库函数 PV 计算两种口径的现值（保持与上方 RATE 的符号约定一致：pmt 为负数）
    const pvDueRaw = PV(monthlyRate, months, -monthly, 0, 1) as unknown
    const pvOrdRaw = PV(monthlyRate, months, -monthly, 0, 0) as unknown
    const pvDue = (typeof pvDueRaw === 'number' && Number.isFinite(pvDueRaw))
      ? pvDueRaw
      : pvAnnuity(monthlyRate, months, monthly, true)
    const pvOrd = (typeof pvOrdRaw === 'number' && Number.isFinite(pvOrdRaw))
      ? pvOrdRaw
      : pvAnnuity(monthlyRate, months, monthly, false)

    // 额外：对“名义总额（如 5999）对应的等额分期计划（PMT=total/months）”计算折现值
    // 按题意：PV = PMT * (1 - (1 + i)^(-n)) / i * (1 + i)
    const pmtNominal = total / months
    const pvNominalOrd = monthlyRate === 0
      ? pmtNominal * months
      : pmtNominal * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate
    const pvNominalDue = pvNominalOrd * (1 + monthlyRate)
    // 和入参 pv 在数学上会接近（若 monthly = total/months 且 due=true），这里同时返回两种口径，避免歧义

    const toFixedNum = (x: number, p: number) => Number.isFinite(x) ? Number(x.toFixed(p)) : x

    return createSuccessResponse({
      inputs: {
        total,
        months,
        pv,
        due: Boolean(due ?? true),
        monthly: toFixedNum(monthly, 6),
      },
      results: {
        monthlyRate: toFixedNum(monthlyRate, precision),
        effectiveAnnualRate: toFixedNum(ear, precision),
        nominalTotal: toFixedNum(monthly * months, 2), // 名义总额（应等于 total）
        presentValueFromInstallmentsDue: toFixedNum(pvDue, 2), // 先付（含当月）口径的现值
        presentValueFromInstallmentsOrdinary: toFixedNum(pvOrd, 2), // 期末（不含当月）口径的现值
  presentValueOfNominalTotalDue: toFixedNum(pvNominalDue, 2), // 使用 PMT=total/months 计算“5999”的折现值（先付）
  presentValueOfNominalTotalOrdinary: toFixedNum(pvNominalOrd, 2), // 使用 PMT=total/months 计算（期末）
      },
      notes: {
        paymentTiming: (due ?? true) ? 'annuity-due (含当月/先付)' : 'ordinary annuity (期末/后付)',
        formulas: {
          pvOrdinary: 'PV = A * (1 - (1 + i)^(-n)) / i',
          pvDue: 'PV_due = PV_ordinary * (1 + i)',
          ear: 'EAR = (1 + i)^12 - 1',
        },
      },
    }, '分期金融测算成功')
  }
  catch (error) {
    return createErrorResponse(error instanceof Error ? error.message : '金融测算失败', 500)
  }
})
