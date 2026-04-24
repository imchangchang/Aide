import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'

import { FrontmatterParser } from '../ingest/FrontmatterParser'
import { LinkExtractor } from '../ingest/LinkExtractor'

const logger = loggerService.withContext('LinkGraphAnalyzer')

export interface GraphNode {
  id: string
  title: string
  type: 'source' | 'entity' | 'concept' | 'synthesis'
  outgoing: string[]
  incoming: string[]
}

export interface GraphStats {
  totalNodes: number
  totalEdges: number
  averageDegree: number
  hubs: { id: string; title: string; degree: number }[]
  clusters: string[][]
}

interface RawPage {
  id: string
  title: string
  type: GraphNode['type']
  slug: string
  wikiLinks: string[]
}

/**
 * Analyze the knowledge base as a directed graph of wiki links.
 *
 * Computes:
 * - Node-level in/out degrees
 * - Hub pages (highly connected)
 * - Connected components (clusters of interlinked pages)
 */
export class LinkGraphAnalyzer {
  private readonly knowledgePath: string
  private readonly parser: FrontmatterParser
  private readonly linkExtractor: LinkExtractor

  constructor(knowledgePath: string) {
    this.knowledgePath = knowledgePath
    this.parser = new FrontmatterParser()
    this.linkExtractor = new LinkExtractor()
  }

  /**
   * Build the link graph and compute statistics.
   */
  async analyze(): Promise<{ nodes: Map<string, GraphNode>; stats: GraphStats }> {
    const pages = await this.collectPages()
    const nodes = this.buildNodes(pages)
    const stats = this.computeStats(nodes)

    logger.info('Graph analysis complete', {
      nodes: stats.totalNodes,
      edges: stats.totalEdges,
      clusters: stats.clusters.length
    })

    return { nodes, stats }
  }

  private async collectPages(): Promise<RawPage[]> {
    const pages: RawPage[] = []
    const categories: GraphNode['type'][] = ['source', 'entity', 'concept', 'synthesis']

    for (const type of categories) {
      const dirPath = path.join(this.knowledgePath, `${type}s`)
      let files: string[]
      try {
        const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
        files = dirents.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name)
      } catch {
        continue
      }

      for (const filename of files) {
        const filePath = path.join(dirPath, filename)
        const content = await fs.promises.readFile(filePath, 'utf-8')
        const parsed = this.parser.parse(content)
        const slug = filename.replace(/\.md$/, '')
        const title = (parsed.frontmatter.title as string) || slug
        const { wikiLinks } = this.linkExtractor.extract(parsed.body)

        pages.push({
          id: slug,
          title,
          type,
          slug,
          wikiLinks
        })
      }
    }

    return pages
  }

  private buildNodes(pages: RawPage[]): Map<string, GraphNode> {
    // Build title -> id lookup for link resolution
    const titleToId = new Map<string, string>()
    for (const page of pages) {
      titleToId.set(page.title.toLowerCase(), page.id)
      titleToId.set(page.slug.toLowerCase(), page.id)
    }

    // Initialize nodes
    const nodes = new Map<string, GraphNode>()
    for (const page of pages) {
      nodes.set(page.id, {
        id: page.id,
        title: page.title,
        type: page.type,
        outgoing: [],
        incoming: []
      })
    }

    // Resolve outgoing links
    for (const page of pages) {
      const node = nodes.get(page.id)!
      for (const link of page.wikiLinks) {
        const targetId = titleToId.get(link.toLowerCase())
        if (targetId && targetId !== page.id) {
          node.outgoing.push(targetId)
          const targetNode = nodes.get(targetId)
          if (targetNode) {
            targetNode.incoming.push(page.id)
          }
        }
      }
    }

    return nodes
  }

  private computeStats(nodes: Map<string, GraphNode>): GraphStats {
    const nodeList = Array.from(nodes.values())
    const totalNodes = nodeList.length

    let totalEdges = 0
    for (const node of nodeList) {
      totalEdges += node.outgoing.length
    }

    const averageDegree = totalNodes > 0 ? totalEdges / totalNodes : 0

    // Hubs: top 10% by total degree (in + out)
    const degrees = nodeList
      .map((n) => ({
        id: n.id,
        title: n.title,
        degree: n.outgoing.length + n.incoming.length
      }))
      .sort((a, b) => b.degree - a.degree)

    const hubThreshold = Math.max(1, Math.ceil(totalNodes * 0.1))
    const hubs = degrees.slice(0, hubThreshold).filter((h) => h.degree > 0)

    // Connected components (undirected view)
    const clusters = this.findClusters(nodes)

    return {
      totalNodes,
      totalEdges,
      averageDegree,
      hubs,
      clusters
    }
  }

  private findClusters(nodes: Map<string, GraphNode>): string[][] {
    const visited = new Set<string>()
    const clusters: string[][] = []

    for (const id of nodes.keys()) {
      if (visited.has(id)) continue

      const cluster: string[] = []
      const queue: string[] = [id]
      visited.add(id)

      while (queue.length > 0) {
        const current = queue.shift()!
        cluster.push(current)
        const node = nodes.get(current)
        if (!node) continue

        const neighbors = new Set([...node.outgoing, ...node.incoming])
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor) && nodes.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }

      clusters.push(cluster)
    }

    return clusters
  }
}
