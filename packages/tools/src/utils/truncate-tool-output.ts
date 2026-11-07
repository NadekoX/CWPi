const MAX_TOOL_OUTPUT_LINES = 2_000;
const MAX_TOOL_OUTPUT_BYTES = 50 * 1_024;

export interface TruncatedToolOutput {
  content: string;
  firstLineExceedsLimit: boolean;
  outputLines: number;
  truncated: boolean;
}

/** 文件与搜索输出按完整行截断，保留分页偏移并避免切断 UTF-8 字符。 */
export function truncateToolOutput(content: string): TruncatedToolOutput {
  const lines = content.length === 0 ? [] : content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  if (
    lines.length <= MAX_TOOL_OUTPUT_LINES &&
    Buffer.byteLength(content) <= MAX_TOOL_OUTPUT_BYTES
  ) {
    return { content, firstLineExceedsLimit: false, outputLines: lines.length, truncated: false };
  }

  const output: string[] = [];
  let outputBytes = 0;
  for (const line of lines) {
    if (output.length >= MAX_TOOL_OUTPUT_LINES) break;
    const lineBytes = Buffer.byteLength(line) + (output.length > 0 ? 1 : 0);
    if (outputBytes + lineBytes > MAX_TOOL_OUTPUT_BYTES) break;
    output.push(line);
    outputBytes += lineBytes;
  }
  return {
    content: output.join("\n"),
    firstLineExceedsLimit:
      output.length === 0 && Buffer.byteLength(lines[0] ?? "") > MAX_TOOL_OUTPUT_BYTES,
    outputLines: output.length,
    truncated: true,
  };
}
