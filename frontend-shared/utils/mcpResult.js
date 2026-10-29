export function parseMCPResult(rawResult) {
  // MCP results come as a string representation of a Python list: "[{'type': 'text', 'text': '...'}]"
  // or JSON format: '[{"type": "text", "text": "..."}]'
  // Extract just the text content.
  if (!rawResult) return ''
  if (typeof rawResult !== 'string') return String(rawResult)

  // Try JSON format first (single quotes replaced with double)
  try {
    const jsonStr = rawResult.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n\n')
    }
  } catch (e) {
    // Not valid JSON, return as-is
  }
  return rawResult
}
