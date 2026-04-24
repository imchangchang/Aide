import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import type { NoteAgentService } from '@main/services/noteagent/core/NoteAgentService'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

import type {
  AgentServiceInterface,
  AgentStream,
  AgentStreamEvent,
  AgentThinkingOptions
} from '../../interfaces/AgentStreamInterface'

const logger = loggerService.withContext('NoteAgentCodeService')

class NoteAgentStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  sdkSessionId?: string
}

type CommandHandler = (args: string) => Promise<string>

class NoteAgentCodeService implements AgentServiceInterface {
  private service: NoteAgentService

  constructor(service: NoteAgentService) {
    this.service = service
  }

  async invoke(
    prompt: string,
    _session: GetAgentSessionResponse,
    abortController: AbortController,
    _lastAgentSessionId?: string,
    _thinkingOptions?: AgentThinkingOptions,
    _images?: Array<{ data: string; media_type: string }>
  ): Promise<AgentStream> {
    const stream = new NoteAgentStream()

    // Parse slash command from prompt
    const trimmed = prompt.trim()
    const commandMatch = trimmed.match(/^\/(\w+)(?:\s+(.*))?$/)

    const handleCommand = async (): Promise<string> => {
      if (!commandMatch) {
        return this.buildHelpMessage()
      }

      const [, cmd, args = ''] = commandMatch
      const handler = this.getCommandHandler(cmd)
      if (!handler) {
        return `Unknown command: /${cmd}\n\n${this.buildHelpMessage()}`
      }
      return handler(args.trim())
    }

    // Start processing on next tick so listeners can subscribe first
    setImmediate(() => {
      this.processCommand(handleCommand, stream, abortController).catch((error) => {
        logger.error('Unhandled NoteAgent stream error', {
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        })
        stream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        })
      })
    })

    return stream
  }

  private async processCommand(
    handleCommand: () => Promise<string>,
    stream: NoteAgentStream,
    abortController: AbortController
  ): Promise<void> {
    if (abortController.signal.aborted) {
      stream.emit('data', { type: 'cancelled', error: new Error('Request aborted') })
      return
    }

    try {
      const text = await handleCommand()

      // Emit as text-delta chunks for UI consumption
      const chunkId = `noteagent-${Date.now()}`
      stream.emit('data', {
        type: 'chunk',
        chunk: { type: 'text-delta', id: chunkId, text: '' } as unknown as TextStreamPart<any>
      })
      stream.emit('data', {
        type: 'chunk',
        chunk: { type: 'text-delta', id: chunkId, text } as unknown as TextStreamPart<any>
      })
      stream.emit('data', {
        type: 'chunk',
        chunk: {
          type: 'finish',
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: { promptTokens: 0, completionTokens: 0 }
        } as unknown as TextStreamPart<any>
      })
      stream.emit('data', { type: 'complete' })
    } catch (error) {
      if (abortController.signal.aborted) {
        stream.emit('data', { type: 'cancelled', error: new Error('Request aborted') })
        return
      }
      stream.emit('data', {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  private getCommandHandler(cmd: string): CommandHandler | undefined {
    const handlers: Record<string, CommandHandler> = {
      ingest: async () => {
        const result = await this.service.ingest()
        return [
          '## Ingest Results',
          `- Added: ${result.summary.added}`,
          `- Modified: ${result.summary.modified}`,
          `- Unchanged: ${result.summary.unchanged}`,
          `- Deleted: ${result.summary.deleted}`,
          result.errors.length > 0 ? `\nErrors: ${result.errors.map((e) => `${e.path}: ${e.error}`).join('\n')}` : ''
        ].join('\n')
      },
      health: async () => {
        const report = await this.service.healthCheck()
        if (report.issues.length === 0) {
          return '## Health Check\n\n✅ Knowledge base is healthy. No issues found.'
        }
        const lines = report.issues.map((i) => `- **[${i.type}]** ${i.page}: ${i.details}`)
        return `## Health Check\n\nFound ${report.issues.length} issues:\n\n${lines.join('\n')}`
      },
      graph: async () => {
        const { stats } = await this.service.analyzeGraph()
        const lines = [
          '## Graph Analysis',
          `- Nodes: ${stats.totalNodes}`,
          `- Edges: ${stats.totalEdges}`,
          `- Clusters: ${stats.clusters?.length ?? 0}`,
          `- Average Degree: ${stats.averageDegree?.toFixed(2) ?? 0}`
        ]
        if (stats.hubs && stats.hubs.length > 0) {
          lines.push(`- Hubs: ${stats.hubs.map((h) => h.title).join(', ')}`)
        }
        return lines.join('\n')
      },
      query: async (args) => {
        if (!args) {
          return 'Usage: /query <keyword>'
        }
        const result = await this.service.query(args)
        if (result.pages.length === 0) {
          return `## Search Results\n\nNo results found for "${args}".`
        }
        const lines = result.pages.map((p) => `**${p.title}** (${p.relativePath})\n${p.excerpt}`)
        return `## Search Results for "${args}"\n\n${lines.join('\n\n')}`
      },
      rebuild: async () => {
        await this.service.rebuildIndex()
        return '## Rebuild Index\n\n✅ Index rebuilt successfully.'
      },
      init: async () => {
        const status = await this.service.status()
        if (status.initialized) {
          return `## Init\n\n✅ NoteAgent is already initialized.\n- Workspace: ${status.workspacePath}`
        }
        await this.service.initWithNotesDir()
        return '## Init\n\n✅ NoteAgent initialized successfully.'
      },
      status: async () => {
        const status = await this.service.status()
        if (!status.initialized) {
          return '## Status\n\n⚠️ NoteAgent is not initialized. Run `/init` to initialize.'
        }
        const lines = [
          '## Status',
          `- Workspace: ${status.workspacePath}`,
          `- Commits: ${status.hasCommits ? status.recentCommits.length + ' recent' : 'none'}`
        ]
        if (status.recentCommits.length > 0) {
          lines.push('', '**Recent commits:**')
          status.recentCommits.forEach((c) => {
            lines.push(`- \`${c.oid}\` ${c.message} — ${new Date(c.date).toLocaleString()}`)
          })
        }
        return lines.join('\n')
      },
      help: async () => this.buildHelpMessage()
    }
    return handlers[cmd]
  }

  private buildHelpMessage(): string {
    return [
      '## NoteAgent Commands',
      '',
      'Available commands:',
      '- `/init` — Initialize NoteAgent with the notes directory',
      '- `/ingest` — Build knowledge base from raw notes',
      '- `/health` — Check knowledge base health',
      '- `/graph` — Analyze link graph',
      '- `/query <keyword>` — Search knowledge base',
      '- `/rebuild` — Rebuild knowledge index',
      '- `/status` — Show current status',
      '- `/help` — Show this help message',
      '',
      'NoteAgent manages your notes by building a structured knowledge base from raw markdown files.'
    ].join('\n')
  }
}

export { NoteAgentCodeService }
