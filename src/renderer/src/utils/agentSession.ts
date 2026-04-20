import type { AgentSessionEntity, AgentType, ApiModelsFilter, Topic, TopicType } from '@renderer/types'

const SESSION_TOPIC_PREFIX = 'agent-session:'

export const buildAgentSessionTopicId = (sessionId: string): string => {
  return `${SESSION_TOPIC_PREFIX}${sessionId}`
}

export const isAgentSessionTopicId = (topicId: string): boolean => {
  return topicId.startsWith(SESSION_TOPIC_PREFIX)
}

export const extractAgentSessionIdFromTopicId = (topicId: string): string => {
  return topicId.replace(SESSION_TOPIC_PREFIX, '')
}

import discordIcon from '@renderer/assets/images/channel/discord.svg'
import feishuIcon from '@renderer/assets/images/channel/feishu.jpeg'
import qqIcon from '@renderer/assets/images/channel/qq.svg'
import slackIcon from '@renderer/assets/images/channel/slack.svg'
import telegramIcon from '@renderer/assets/images/channel/telegram.png'
import wechatIcon from '@renderer/assets/images/channel/wechat.png'

const CHANNEL_TYPE_ICONS: Record<string, string> = {
  telegram: telegramIcon,
  feishu: feishuIcon,
  qq: qqIcon,
  wechat: wechatIcon,
  discord: discordIcon,
  slack: slackIcon
}

export const getChannelTypeIcon = (channelType: string | undefined): string | undefined => {
  if (!channelType) return undefined
  return CHANNEL_TYPE_ICONS[channelType]
}

export const getModelFilterByAgentType = (type: AgentType): ApiModelsFilter => {
  switch (type) {
    case 'claude-code':
      return {
        providerType: 'anthropic'
      }
    default:
      return {}
  }
}

/**
 * Convert AgentSessionEntity to Topic format for export compatibility
 * This allows agent sessions to use the existing topic export functions
 *
 * The messages array is intentionally left empty because:
 * 1. Agent session messages are stored in SQLite (main process), not IndexedDB
 * 2. Export functions will fetch messages via fetchTopicMessages() which:
 *    - Detects the "agent-session:" prefix in topic.id
 *    - Routes to AgentMessageDataSource (SQLite) via DbService
 *    - Loads messages into Redux store via loadTopicMessagesThunk
 *    - Returns messages via selectMessagesForTopic selector
 * 3. This approach ensures messages are fetched from the correct data source
 *    without duplicating data in memory
 *
 * @param session - The agent session to convert
 * @param agentId - The agent ID that owns this session
 * @returns A Topic object compatible with export functions
 *
 * @example
 * const session = await getSession('session-123')
 * const topic = convertSessionToTopic(session, 'agent-456')
 * // topic.id will be "agent-session:session-123"
 * // Export functions will automatically fetch messages from SQLite
 * await exportTopicAsMarkdown(topic)
 */
export const convertSessionToTopic = (session: AgentSessionEntity, agentId: string): Topic => {
  return {
    id: buildAgentSessionTopicId(session.id),
    type: 'session' as TopicType,
    assistantId: agentId,
    name: session.name || session.id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messages: [], // Empty - messages fetched on-demand from SQLite via DbService
    pinned: false
  }
}
