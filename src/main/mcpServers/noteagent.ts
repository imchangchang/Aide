import { loggerService } from '@logger'
import type { NoteAgentService } from '@main/services/noteagent/core/NoteAgentService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('MCPServer:NoteAgent')

const INGEST_TOOL: Tool = {
  name: 'ingest',
  description:
    'Run the knowledge base ingest pipeline. Scans raw notes, parses frontmatter, builds source pages, and updates the knowledge index.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

const HEALTH_CHECK_TOOL: Tool = {
  name: 'health_check',
  description: 'Check the knowledge base health. Reports orphans, broken links, and empty categories.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

const ANALYZE_GRAPH_TOOL: Tool = {
  name: 'analyze_graph',
  description: 'Analyze the knowledge base link graph. Returns node count, edge count, clusters, and hub pages.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

const QUERY_TOOL: Tool = {
  name: 'query',
  description: 'Search the knowledge base by keyword. Searches both titles and body text.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The keyword to search for'
      }
    },
    required: ['keyword']
  }
}

const REBUILD_INDEX_TOOL: Tool = {
  name: 'rebuild_index',
  description: 'Rebuild the knowledge base index manually.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

const STATUS_TOOL: Tool = {
  name: 'status',
  description: 'Get the current NoteAgent status including initialization state and recent git commits.',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}

class NoteAgentMcpServer {
  public mcpServer: McpServer
  private service: NoteAgentService

  constructor(service: NoteAgentService) {
    this.service = service
    this.mcpServer = new McpServer(
      {
        name: 'noteagent',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [INGEST_TOOL, HEALTH_CHECK_TOOL, ANALYZE_GRAPH_TOOL, QUERY_TOOL, REBUILD_INDEX_TOOL, STATUS_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'ingest': {
            const result = await this.service.ingest()
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Ingest complete. Added: ${result.summary.added}, Modified: ${result.summary.modified}, Unchanged: ${result.summary.unchanged}, Deleted: ${result.summary.deleted}`
                }
              ]
            }
          }
          case 'health_check': {
            const report = await this.service.healthCheck()
            const issueCount = report.issues.length
            if (issueCount === 0) {
              return {
                content: [{ type: 'text' as const, text: 'Knowledge base is healthy. No issues found.' }]
              }
            }
            const lines = report.issues.map((i) => `[${i.type}] ${i.page}: ${i.details}`)
            return {
              content: [{ type: 'text' as const, text: `Found ${issueCount} issues:\n${lines.join('\n')}` }]
            }
          }
          case 'analyze_graph': {
            const { stats } = await this.service.analyzeGraph()
            const lines = [
              `Nodes: ${stats.totalNodes}`,
              `Edges: ${stats.totalEdges}`,
              `Clusters: ${stats.clusters?.length ?? 0}`,
              `Average Degree: ${stats.averageDegree?.toFixed(2) ?? 0}`
            ]
            if (stats.hubs && stats.hubs.length > 0) {
              lines.push(`Hubs: ${stats.hubs.map((h) => h.title).join(', ')}`)
            }
            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }]
            }
          }
          case 'query': {
            const keyword = args.keyword as string
            if (!keyword) {
              throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: keyword')
            }
            const result = await this.service.query(keyword)
            if (result.pages.length === 0) {
              return {
                content: [{ type: 'text' as const, text: `No results found for "${keyword}".` }]
              }
            }
            const lines = result.pages.map((p) => `**${p.title}** (${p.relativePath})\n${p.excerpt}`)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Found ${result.pages.length} results for "${keyword}":\n\n${lines.join('\n\n')}`
                }
              ]
            }
          }
          case 'rebuild_index': {
            await this.service.rebuildIndex()
            return {
              content: [{ type: 'text' as const, text: 'Index rebuilt successfully.' }]
            }
          }
          case 'status': {
            const status = await this.service.status()
            if (!status.initialized) {
              return {
                content: [{ type: 'text' as const, text: 'NoteAgent is not initialized.' }]
              }
            }
            const lines = [
              `Workspace: ${status.workspacePath}`,
              `Commits: ${status.hasCommits ? status.recentCommits.length + ' recent' : 'none'}`
            ]
            if (status.recentCommits.length > 0) {
              lines.push('Recent commits:')
              status.recentCommits.forEach((c) => {
                lines.push(`  ${c.oid} ${c.message} — ${new Date(c.date).toLocaleString()}`)
              })
            }
            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }]
            }
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }
}

export { NoteAgentMcpServer }
