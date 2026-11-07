import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";

/** Harness 历史偏移只计对话消息，保持已有 JSONL checkpoint 的索引语义。 */
export function conversationMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => message.role !== "system");
}

/** 系统提示和工具增量属于模型 transcript，不作为用户消息持久化。 */
export function withTranscriptSystemMessage(
  source: readonly AgentMessage[],
  projected: readonly AgentMessage[],
): AgentMessage[] {
  const system = getCurrentSystemMessage(source);
  const messages = conversationMessages(projected);
  return system ? [system, ...messages] : messages;
}

export function updateAgentSystemPrompt(agent: Agent, content: string): void {
  const first = agent.state.messages[0];
  if (first?.role === "system") {
    agent.state.messages = [{ ...first, content }, ...agent.state.messages.slice(1)];
  } else {
    agent.state.messages = [{ role: "system", content, timestamp: 0 }, ...agent.state.messages];
  }
}
