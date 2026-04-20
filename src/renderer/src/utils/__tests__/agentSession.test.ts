import type { AgentSessionEntity } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  buildAgentSessionTopicId,
  convertSessionToTopic,
  extractAgentSessionIdFromTopicId,
  isAgentSessionTopicId
} from '../agentSession'

describe('agentSession utilities', () => {
  describe('buildAgentSessionTopicId', () => {
    it('should build topic ID with correct prefix', () => {
      const sessionId = 'session-123'
      const topicId = buildAgentSessionTopicId(sessionId)
      expect(topicId).toBe('agent-session:session-123')
    })

    it('should handle empty session ID', () => {
      const topicId = buildAgentSessionTopicId('')
      expect(topicId).toBe('agent-session:')
    })

    it('should handle session ID with special characters', () => {
      const sessionId = 'session-123-abc_def'
      const topicId = buildAgentSessionTopicId(sessionId)
      expect(topicId).toBe('agent-session:session-123-abc_def')
    })
  })

  describe('isAgentSessionTopicId', () => {
    it('should return true for valid agent session topic IDs', () => {
      expect(isAgentSessionTopicId('agent-session:123')).toBe(true)
      expect(isAgentSessionTopicId('agent-session:session-abc')).toBe(true)
      expect(isAgentSessionTopicId('agent-session:')).toBe(true)
    })

    it('should return false for non-agent session topic IDs', () => {
      expect(isAgentSessionTopicId('regular-topic-id')).toBe(false)
      expect(isAgentSessionTopicId('topic-123')).toBe(false)
      expect(isAgentSessionTopicId('')).toBe(false)
    })

    it('should return false for partial matches', () => {
      expect(isAgentSessionTopicId('agent-session')).toBe(false)
      expect(isAgentSessionTopicId('session:123')).toBe(false)
    })
  })

  describe('extractAgentSessionIdFromTopicId', () => {
    it('should extract session ID from topic ID', () => {
      const topicId = 'agent-session:session-123'
      const sessionId = extractAgentSessionIdFromTopicId(topicId)
      expect(sessionId).toBe('session-123')
    })

    it('should handle topic ID with empty session ID', () => {
      const topicId = 'agent-session:'
      const sessionId = extractAgentSessionIdFromTopicId(topicId)
      expect(sessionId).toBe('')
    })

    it('should handle non-agent session topic IDs', () => {
      const topicId = 'regular-topic-id'
      const sessionId = extractAgentSessionIdFromTopicId(topicId)
      expect(sessionId).toBe('regular-topic-id')
    })
  })

  describe('convertSessionToTopic', () => {
    const createMockSession = (overrides?: Partial<AgentSessionEntity>): AgentSessionEntity => ({
      id: 'session-123',
      agent_id: 'agent-456',
      agent_type: 'claude-code',
      name: 'Test Session',
      description: 'A test session',
      accessible_paths: [],
      instructions: 'Test instructions',
      model: 'claude-3-5-sonnet-20241022',
      mcps: [],
      allowed_tools: [],
      slash_commands: [],
      configuration: {
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {}
      },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      ...overrides
    })

    it('should convert session to topic with correct structure', () => {
      const session = createMockSession()
      const agentId = 'agent-456'

      const topic = convertSessionToTopic(session, agentId)

      expect(topic).toEqual({
        id: 'agent-session:session-123',
        type: TopicType.Session,
        assistantId: 'agent-456',
        name: 'Test Session',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        messages: [],
        pinned: false
      })
    })

    it('should generate correct topicId format', () => {
      const session = createMockSession({ id: 'my-session-id' })
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.id).toBe('agent-session:my-session-id')
      expect(isAgentSessionTopicId(topic.id)).toBe(true)
    })

    it('should use session.id as fallback when name is empty', () => {
      const session = createMockSession({ name: '' })
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.name).toBe('session-123')
    })

    it('should use session.id as fallback when name is undefined', () => {
      const session = createMockSession({ name: undefined })
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.name).toBe('session-123')
    })

    it('should set type to session', () => {
      const session = createMockSession()
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.type).toBe(TopicType.Session)
      expect(topic.type).toBe('session')
    })

    it('should set messages to empty array', () => {
      const session = createMockSession()
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.messages).toEqual([])
      expect(Array.isArray(topic.messages)).toBe(true)
    })

    it('should set pinned to false', () => {
      const session = createMockSession()
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.pinned).toBe(false)
    })

    it('should use provided agentId as assistantId', () => {
      const session = createMockSession({ agent_id: 'different-agent' })
      const topic = convertSessionToTopic(session, 'provided-agent-id')

      expect(topic.assistantId).toBe('provided-agent-id')
    })

    it('should preserve timestamps correctly', () => {
      const createdAt = '2024-06-15T10:30:00Z'
      const updatedAt = '2024-06-16T15:45:00Z'
      const session = createMockSession({ created_at: createdAt, updated_at: updatedAt })

      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.createdAt).toBe(createdAt)
      expect(topic.updatedAt).toBe(updatedAt)
    })

    it('should handle session with special characters in name', () => {
      const session = createMockSession({ name: 'Test Session: 测试 & Special <chars>' })
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.name).toBe('Test Session: 测试 & Special <chars>')
    })

    it('should handle very long session names', () => {
      const longName = 'A'.repeat(1000)
      const session = createMockSession({ name: longName })
      const topic = convertSessionToTopic(session, 'agent-123')

      expect(topic.name).toBe(longName)
      expect(topic.name.length).toBe(1000)
    })

    it('should be a pure function (no side effects)', () => {
      const session = createMockSession()
      const originalSession = { ...session }

      convertSessionToTopic(session, 'agent-123')

      // Session should not be modified
      expect(session).toEqual(originalSession)
    })

    it('should create independent topic objects', () => {
      const session = createMockSession()
      const topic1 = convertSessionToTopic(session, 'agent-1')
      const topic2 = convertSessionToTopic(session, 'agent-2')

      // Modifying one should not affect the other
      topic1.name = 'Modified'
      expect(topic2.name).toBe('Test Session')
    })
  })

  describe('integration: round-trip conversion', () => {
    it('should maintain session ID through conversion', () => {
      const session: AgentSessionEntity = {
        id: 'original-session-id',
        agent_id: 'agent-123',
        agent_type: 'claude-code',
        name: 'Test',
        accessible_paths: [],
        model: 'claude-3-5-sonnet-20241022',
        mcps: [],
        allowed_tools: [],
        slash_commands: [],
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {}
        },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      const topic = convertSessionToTopic(session, 'agent-123')
      const extractedSessionId = extractAgentSessionIdFromTopicId(topic.id)

      expect(extractedSessionId).toBe('original-session-id')
    })
  })
})
