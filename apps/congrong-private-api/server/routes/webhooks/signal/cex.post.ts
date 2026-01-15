export default eventHandler(async (event) => {
  const body = await readBody(event)
  const channelId = getTelegramChannel('signal:cex')

  try {
    const { chain, type, amount, symbol, sender, receiver, tags, signature } = body

    const isInflow = type?.toLowerCase() === 'inflow'
    const emoji = isInflow ? '🟢' : '🔴'
    const typeStr = isInflow ? 'Inflow \\(充值\\)' : 'Outflow \\(提现\\)'

    // Construct Etherscan/Solscan link based on chain
    let txLink = `\`${signature}\``
    if (chain === 'ETH') {
      txLink = `[${escapeMarkdown(shorten(signature))}](https://etherscan.io/tx/${signature})`
    }
    else if (chain === 'SOL') {
      txLink = `[${escapeMarkdown(shorten(signature))}](https://solscan.io/tx/${signature})`
    }

    const message = `
${emoji} *CEX ${typeStr} Alert*

*Amount:* \`${amount} ${symbol}\`
*Chain:* ${escapeMarkdown(chain)}
*Exchange/Tag:* ${escapeMarkdown(tags || 'Unknown')}

*Sender:* \`${shorten(sender)}\`
*Receiver:* \`${shorten(receiver)}\`
*Tx:* ${txLink}

\\#CEX \\#${escapeMarkdown(symbol)} \\#${escapeMarkdown(type)}
`.trim()

    await bot.api.sendMessage(channelId, message, {
      parse_mode: 'MarkdownV2',
      link_preview_options: { is_disabled: true },
    })

    return { status: 'ok' }
  }
  catch (error) {
    console.error('Error processing CEX signal webhook:', error)
    // Return 200 to acknowledge receipt even if processing fails to prevent retries (or depending on policy)
    // But usually webhook senders want 200.
    return { status: 'error', message: String(error) }
  }
})

function shorten(str: string | undefined) {
  if (!str) { return 'N/A' }
  if (str.length < 10) { return str }
  return `${str.slice(0, 6)}...${str.slice(-4)}`
}
