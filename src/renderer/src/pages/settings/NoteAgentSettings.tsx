import { useTheme } from '@renderer/context/ThemeProvider'
import { Button, Input, message, Space, Tag, Tooltip } from 'antd'
import { BookOpen, FolderOpen, GitBranch, HeartPulse, Network, RotateCw, Search } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

interface NoteAgentStatus {
  initialized: boolean
  workspacePath?: string
  hasCommits: boolean
  recentCommits: { oid: string; message: string; date: string }[]
}

interface HealthIssue {
  type: 'orphan' | 'broken-link' | 'empty-category'
  page: string
  details: string
}

interface HealthReport {
  issues: HealthIssue[]
  summary: {
    orphans: number
    brokenLinks: number
    emptyCategories: number
  }
}

interface GraphHub {
  id: string
  title: string
  degree: number
}

interface GraphStats {
  totalNodes: number
  totalEdges: number
  averageDegree: number
  hubs: GraphHub[]
  clusters: string[][]
}

const NoteAgentSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [workspacePath, setWorkspacePath] = useState('')
  const [status, setStatus] = useState<NoteAgentStatus | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [queryKeyword, setQueryKeyword] = useState('')
  const [queryResults, setQueryResults] = useState<{ title: string; relativePath: string; excerpt: string }[]>([])
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null)
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null)

  useEffect(() => {
    void window.api.getAppInfo().then((info) => {
      if (info?.appDataPath) {
        setWorkspacePath(`${info.appDataPath}/note-agent`)
      }
    })
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.noteAgent.status()
      setStatus(s)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshStatus()
      }
    }, 5000)
    return () => clearInterval(id)
  }, [refreshStatus])

  const handleSelectFolder = async () => {
    const result = await window.api.file.selectFolder()
    if (result) {
      setWorkspacePath(result)
    }
  }

  const handleInit = async () => {
    if (!workspacePath) {
      message.warning(t('settings.noteAgent.workspace.required'))
      return
    }
    setLoading('init')
    try {
      await window.api.noteAgent.init(workspacePath)
      message.success(t('settings.noteAgent.init.success'))
      await refreshStatus()
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.init.failed'))
    } finally {
      setLoading(null)
    }
  }

  const handleIngest = async () => {
    setLoading('ingest')
    try {
      const result = await window.api.noteAgent.ingest()
      message.success(t('settings.noteAgent.ingest.success', { count: result.summary?.added ?? 0 }))
      await refreshStatus()
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.ingest.failed'))
    } finally {
      setLoading(null)
    }
  }

  const handleHealthCheck = async () => {
    setLoading('health')
    try {
      const report = await window.api.noteAgent.healthCheck()
      setHealthReport(report)
      message.success(t('settings.noteAgent.health.success', { issues: report.issues?.length ?? 0 }))
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.health.failed'))
    } finally {
      setLoading(null)
    }
  }

  const handleAnalyzeGraph = async () => {
    setLoading('graph')
    try {
      const { stats } = await window.api.noteAgent.analyzeGraph()
      setGraphStats(stats)
      message.success(t('settings.noteAgent.graph.success'))
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.graph.failed'))
    } finally {
      setLoading(null)
    }
  }

  const handleQuery = async () => {
    if (!queryKeyword.trim()) return
    setLoading('query')
    try {
      const result = await window.api.noteAgent.query(queryKeyword.trim())
      setQueryResults(result.pages || [])
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.query.failed'))
    } finally {
      setLoading(null)
    }
  }

  const handleRebuildIndex = async () => {
    setLoading('rebuild')
    try {
      await window.api.noteAgent.rebuildIndex()
      message.success(t('settings.noteAgent.rebuild.success'))
    } catch (error: any) {
      message.error(error?.message || t('settings.noteAgent.rebuild.failed'))
    } finally {
      setLoading(null)
    }
  }

  const isInitialized = status?.initialized ?? false

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.noteAgent.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder={t('settings.noteAgent.workspace.placeholder')}
            style={{ flex: 1 }}
          />
          <Button icon={<FolderOpen size={16} />} onClick={handleSelectFolder}>
            {t('settings.noteAgent.workspace.select')}
          </Button>
          <Button type="primary" loading={loading === 'init'} onClick={handleInit}>
            {t('settings.noteAgent.init.button')}
          </Button>
        </SettingRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.noteAgent.status.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Space>
            <Tag color={isInitialized ? 'green' : 'red'}>
              {isInitialized
                ? t('settings.noteAgent.status.initialized')
                : t('settings.noteAgent.status.notInitialized')}
            </Tag>
            {status?.workspacePath && (
              <Tag>
                <GitBranch size={12} style={{ marginRight: 4 }} />
                {status.hasCommits
                  ? t('settings.noteAgent.status.hasCommits', { count: status.recentCommits.length })
                  : t('settings.noteAgent.status.noCommits')}
              </Tag>
            )}
          </Space>
        </SettingRow>
        {status?.recentCommits && status.recentCommits.length > 0 && (
          <>
            <SettingDivider />
            <div style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
              {status.recentCommits.map((c) => (
                <div key={c.oid} style={{ marginBottom: 4 }}>
                  <code>{c.oid}</code> {c.message} — {new Date(c.date).toLocaleString()}
                </div>
              ))}
            </div>
          </>
        )}
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.noteAgent.actions.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ gap: 8, flexWrap: 'wrap' }}>
          <Tooltip title={!isInitialized ? t('settings.noteAgent.actions.requireInit') : undefined}>
            <Button
              icon={<RotateCw size={16} />}
              loading={loading === 'ingest'}
              disabled={!isInitialized}
              onClick={handleIngest}>
              {t('settings.noteAgent.actions.ingest')}
            </Button>
          </Tooltip>
          <Tooltip title={!isInitialized ? t('settings.noteAgent.actions.requireInit') : undefined}>
            <Button
              icon={<HeartPulse size={16} />}
              loading={loading === 'health'}
              disabled={!isInitialized}
              onClick={handleHealthCheck}>
              {t('settings.noteAgent.actions.healthCheck')}
            </Button>
          </Tooltip>
          <Tooltip title={!isInitialized ? t('settings.noteAgent.actions.requireInit') : undefined}>
            <Button
              icon={<Network size={16} />}
              loading={loading === 'graph'}
              disabled={!isInitialized}
              onClick={handleAnalyzeGraph}>
              {t('settings.noteAgent.actions.analyzeGraph')}
            </Button>
          </Tooltip>
          <Tooltip title={!isInitialized ? t('settings.noteAgent.actions.requireInit') : undefined}>
            <Button
              icon={<BookOpen size={16} />}
              loading={loading === 'rebuild'}
              disabled={!isInitialized}
              onClick={handleRebuildIndex}>
              {t('settings.noteAgent.actions.rebuildIndex')}
            </Button>
          </Tooltip>
        </SettingRow>
      </SettingGroup>

      {healthReport && (
        <SettingGroup theme={theme}>
          <SettingTitle>
            {t('settings.noteAgent.health.title')}
            <Tag color={healthReport.issues.length === 0 ? 'green' : 'orange'}>{healthReport.issues.length} issues</Tag>
          </SettingTitle>
          <SettingDivider />
          {healthReport.issues.length === 0 ? (
            <div style={{ color: 'var(--color-text-2)' }}>{t('settings.noteAgent.health.allGood')}</div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
              {healthReport.issues.map((issue, idx) => (
                <div key={idx} style={{ marginBottom: 4 }}>
                  <Tag>{issue.type}</Tag> <strong>{issue.page}</strong>: {issue.details}
                </div>
              ))}
            </div>
          )}
        </SettingGroup>
      )}

      {graphStats && (
        <SettingGroup theme={theme}>
          <SettingTitle>{t('settings.noteAgent.graph.title')}</SettingTitle>
          <SettingDivider />
          <Space wrap>
            <Tag>{t('settings.noteAgent.graph.nodes', { count: graphStats.totalNodes })}</Tag>
            <Tag>{t('settings.noteAgent.graph.edges', { count: graphStats.totalEdges })}</Tag>
            <Tag>{t('settings.noteAgent.graph.clusters', { count: graphStats.clusters?.length ?? 0 })}</Tag>
            <Tag>{t('settings.noteAgent.graph.avgDegree', { value: graphStats.averageDegree?.toFixed(2) ?? 0 })}</Tag>
          </Space>
          {graphStats.hubs && graphStats.hubs.length > 0 && (
            <>
              <SettingDivider />
              <div style={{ fontSize: 12, color: 'var(--color-text-2)', marginTop: 8 }}>
                <strong>{t('settings.noteAgent.graph.hubs')}:</strong> {graphStats.hubs.map((h) => h.title).join(', ')}
              </div>
            </>
          )}
        </SettingGroup>
      )}

      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.noteAgent.query.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Input
            value={queryKeyword}
            onChange={(e) => setQueryKeyword(e.target.value)}
            onPressEnter={handleQuery}
            placeholder={t('settings.noteAgent.query.placeholder')}
            style={{ flex: 1 }}
          />
          <Button
            icon={<Search size={16} />}
            type="primary"
            loading={loading === 'query'}
            disabled={!isInitialized || !queryKeyword.trim()}
            onClick={handleQuery}>
            {t('settings.noteAgent.query.button')}
          </Button>
        </SettingRow>
        {queryResults.length > 0 && (
          <>
            <SettingDivider />
            <div style={{ marginTop: 8 }}>
              {queryResults.map((page, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '8px 12px',
                    marginBottom: 8,
                    borderRadius: 6,
                    background: 'var(--color-bg-2)',
                    fontSize: 13
                  }}>
                  <strong style={{ color: 'var(--color-text-1)' }}>{page.title}</strong>
                  <div style={{ color: 'var(--color-text-3)', fontSize: 11, marginTop: 2 }}>{page.relativePath}</div>
                  <div style={{ color: 'var(--color-text-2)', marginTop: 4 }}>{page.excerpt}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </SettingGroup>
    </SettingContainer>
  )
}

export default NoteAgentSettings
