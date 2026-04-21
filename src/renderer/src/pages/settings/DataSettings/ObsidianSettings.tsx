import { loggerService } from '@logger'
import { HStack } from '@renderer/components/Layout'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setNotesPath } from '@renderer/store/note'
import {
  setDefaultObsidianVault,
  setNotesObsidianVault,
  setNotesUseDefaultObsidianVault
} from '@renderer/store/settings'
import { Checkbox, Empty, Select, Spin } from 'antd'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const logger = loggerService.withContext('ObsidianSettings')

const { Option } = Select

const ObsidianSettings: FC = () => {
  const { t } = useTranslation()
  const { defaultObsidianVault, notesObsidianVault, notesUseDefaultObsidianVault } = useSettings()
  const dispatch = useAppDispatch()

  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // 组件加载时获取Vault列表
  useEffect(() => {
    const fetchVaults = async () => {
      try {
        setLoading(true)
        setError(null)
        const vaultsData = await window.api.obsidian.getVaults()

        if (vaultsData.length === 0) {
          setError(t('settings.data.obsidian.default_vault_no_vaults'))
          setLoading(false)
          return
        }

        setVaults(vaultsData)

        // 如果没有设置默认vault，则选择第一个
        if (!defaultObsidianVault && vaultsData.length > 0) {
          dispatch(setDefaultObsidianVault(vaultsData[0].name))
        }

        // 同步 notesPath 到 Obsidian vault 路径
        const targetVaultName = notesUseDefaultObsidianVault ? defaultObsidianVault : notesObsidianVault
        if (targetVaultName) {
          const vault = vaultsData.find((v) => v.name === targetVaultName)
          if (vault) {
            dispatch(setNotesPath(vault.path))
          }
        }
      } catch (error) {
        logger.error('获取Obsidian Vault失败:', error as Error)
        setError(t('settings.data.obsidian.default_vault_fetch_error'))
      } finally {
        setLoading(false)
      }
    }

    void fetchVaults()
  }, [dispatch, defaultObsidianVault, notesObsidianVault, notesUseDefaultObsidianVault, t])

  const handleChange = (value: string) => {
    dispatch(setDefaultObsidianVault(value))
  }

  const getVaultPathByName = (name: string): string | undefined => {
    return vaults.find((v) => v.name === name)?.path
  }

  const syncNotesPath = (vaultName: string | null) => {
    if (!vaultName) return
    const vaultPath = getVaultPathByName(vaultName)
    if (vaultPath) {
      dispatch(setNotesPath(vaultPath))
    }
  }

  const handleNotesVaultChange = (value: string) => {
    dispatch(setNotesObsidianVault(value))
    syncNotesPath(value)
  }

  const handleNotesUseDefaultChange = (checked: boolean) => {
    dispatch(setNotesUseDefaultObsidianVault(checked))
    if (checked && defaultObsidianVault) {
      syncNotesPath(defaultObsidianVault)
    } else if (!checked && notesObsidianVault) {
      syncNotesPath(notesObsidianVault)
    }
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.data.obsidian.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.default_vault')}</SettingRowTitle>
        <HStack gap="5px">
          <Spin spinning={loading} size="small">
            {vaults.length > 0 ? (
              <Select
                value={defaultObsidianVault || undefined}
                onChange={handleChange}
                placeholder={t('settings.data.obsidian.default_vault_placeholder')}
                style={{ width: 300 }}>
                {vaults.map((vault) => (
                  <Option key={vault.name} value={vault.name}>
                    {vault.name}
                  </Option>
                ))}
              </Select>
            ) : (
              <Empty
                description={
                  loading
                    ? t('settings.data.obsidian.default_vault_loading')
                    : error || t('settings.data.obsidian.default_vault_no_vaults')
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Spin>
        </HStack>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.obsidian.notes_vault')}</SettingRowTitle>
        <HStack gap="10px" alignItems="center">
          <Checkbox
            checked={notesUseDefaultObsidianVault}
            onChange={(e) => handleNotesUseDefaultChange(e.target.checked)}>
            {t('settings.data.obsidian.notes_use_default_vault')}
          </Checkbox>
          <Spin spinning={loading} size="small">
            {vaults.length > 0 ? (
              <Select
                value={
                  notesUseDefaultObsidianVault ? defaultObsidianVault || undefined : notesObsidianVault || undefined
                }
                onChange={handleNotesVaultChange}
                placeholder={t('settings.data.obsidian.notes_vault_placeholder')}
                disabled={notesUseDefaultObsidianVault}
                style={{ width: 300 }}>
                {vaults.map((vault) => (
                  <Option key={vault.name} value={vault.name}>
                    {vault.name}
                  </Option>
                ))}
              </Select>
            ) : (
              <Empty
                description={
                  loading
                    ? t('settings.data.obsidian.default_vault_loading')
                    : error || t('settings.data.obsidian.default_vault_no_vaults')
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Spin>
        </HStack>
      </SettingRow>
    </SettingGroup>
  )
}

export default ObsidianSettings
