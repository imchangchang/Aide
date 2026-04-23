import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import type { NotesTreeNode } from '@renderer/types/note'
import { cn } from '@renderer/utils'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AgentWorkspaceSidebar')

interface AgentWorkspaceSidebarProps {
  accessiblePaths: string[]
}

interface TreeNodeProps {
  node: NotesTreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (nodeId: string) => void
  onDragStart: (e: React.DragEvent, path: string) => void
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, depth, expandedPaths, onToggle, onDragStart }) => {
  const isExpanded = expandedPaths.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isFolder = node.type === 'folder'

  return (
    <div>
      <div
        className={cn(
          'flex select-none items-center gap-1 py-1 pr-2 text-xs hover:bg-black/5 dark:hover:bg-white/5',
          isFolder ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        draggable={!isFolder}
        onDragStart={(e) => onDragStart(e, node.externalPath)}
        onClick={() => isFolder && onToggle(node.id)}>
        {isFolder ? (
          isExpanded ? (
            <ChevronDown size={12} className="shrink-0 text-foreground-400" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-foreground-400" />
          )
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}
        {isFolder ? (
          isExpanded ? (
            <FolderOpen size={14} className="shrink-0 text-amber-500" />
          ) : (
            <Folder size={14} className="shrink-0 text-amber-500" />
          )
        ) : (
          <Icon
            icon={`material-icon-theme:${getFileIconName(node.externalPath)}`}
            className="shrink-0"
            style={{ fontSize: 14 }}
          />
        )}
        <span className="truncate text-foreground-700 dark:text-foreground-300">{node.name}</span>
      </div>
      {isFolder && isExpanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onDragStart={onDragStart}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const AgentWorkspaceSidebar: React.FC<AgentWorkspaceSidebarProps> = ({ accessiblePaths }) => {
  const { t } = useTranslation()
  const [treeData, setTreeData] = useState<NotesTreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const watcherCleanupRef = useRef<(() => void) | null>(null)

  const workspacePath = accessiblePaths[0]

  const loadTree = useCallback(async () => {
    if (!workspacePath) return
    setIsLoading(true)
    try {
      const tree = await window.api.file.getDirectoryStructure(workspacePath)
      setTreeData(tree)
    } catch (error) {
      logger.error('Failed to load directory structure', error as Error)
    } finally {
      setIsLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) return

    void loadTree()

    window.api.file
      .startFileWatcher(workspacePath)
      .then(() => {
        logger.debug('File watcher started', { path: workspacePath })
      })
      .catch((e) => {
        logger.warn('Failed to start file watcher', e)
      })

    watcherCleanupRef.current = window.api.file.onFileChange((data) => {
      if (data.watchPath === workspacePath) {
        void loadTree()
      }
    })

    return () => {
      if (watcherCleanupRef.current) {
        watcherCleanupRef.current()
        watcherCleanupRef.current = null
      }
      window.api.file.stopFileWatcher().catch(() => {})
    }
  }, [workspacePath, loadTree])

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('codefiles', JSON.stringify([path]))
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  if (!workspacePath) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-4 text-foreground-400 text-xs">
        <File size={24} className="mb-2 opacity-50" />
        <span>{t('agent.workspace.empty')}</span>
      </div>
    )
  }

  const folderName = workspacePath.split(/[/\\]/).filter(Boolean).pop() || workspacePath

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-[var(--color-border)] border-l bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex h-(--navbar-height) shrink-0 items-center justify-between border-[var(--color-border)] border-b px-3">
        <span className="truncate font-medium text-foreground-700 text-xs dark:text-foreground-300">{folderName}</span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {isLoading && treeData.length === 0 ? (
          <div className="flex h-20 items-center justify-center">
            <span className="text-foreground-400 text-xs">{t('common.loading')}</span>
          </div>
        ) : (
          treeData.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              onToggle={toggleExpanded}
              onDragStart={handleDragStart}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default AgentWorkspaceSidebar
