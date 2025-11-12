#!/bin/bash

echo "测试 AI MedSci Chat SSE 接口"
echo "================================"

# 测试基础连接
echo "1. 测试基础连接（blocking 模式）"
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {},
    "query": "中药方组成",
    "response_mode": "blocking",
    "conversation_id": "",
    "user": "测试用户",
    "files": []
  }' \
  http://localhost:3000/api/thirdparty/ai-medsci-chat

echo -e "\n\n"

# 测试 SSE 流式响应
echo "2. 测试 SSE 流式响应（streaming 模式）"
echo "注意: 请在另一个终端运行此命令以观察流式输出"

curl -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "inputs": {},
    "query": "请介绍一下中药方剂的组成",
    "response_mode": "streaming",
    "conversation_id": "",
    "user": "测试用户",
    "files": []
  }' \
  http://localhost:3000/api/thirdparty/ai-medsci-chat