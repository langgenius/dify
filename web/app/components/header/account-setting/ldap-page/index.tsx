'use client'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@langgenius/dify-ui/toast'
import { Button } from '@langgenius/dify-ui/button'
import { getLDAPSettings, saveLDAPSettings, testLDAPConnection } from '@/service/sso'

const labelClassName = 'mb-1 system-sm-semibold text-text-secondary'
const inputClassName = 'w-full px-3 py-2 border border-divider-subtle rounded-lg bg-components-input-bg text-components-input-text system-sm-regular focus:outline-none focus:border-primary-500'

export default function LdapPage() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  
  const [enabled, setEnabled] = useState(false)
  const [serverHost, setServerHost] = useState('')
  const [serverPort, setServerPort] = useState(389)
  const [useSsl, setUseSsl] = useState(false)
  const [bindDn, setBindDn] = useState('')
  const [bindPassword, setBindPassword] = useState('')
  const [userSearchBase, setUserSearchBase] = useState('')
  const [userSearchFilter, setUserSearchFilter] = useState('(&(objectClass=user)(sAMAccountName={username}))')
  const [mailAttribute, setMailAttribute] = useState('mail')
  const [nameAttribute, setNameAttribute] = useState('displayName')
  const [fallbackToLocal, setFallbackToLocal] = useState(true)

  useEffect(() => {
    getLDAPSettings()
      .then((res) => {
        setEnabled(res.enabled)
        setServerHost(res.server_host)
        setServerPort(res.server_port)
        setUseSsl(res.use_ssl)
        setBindDn(res.bind_dn)
        setBindPassword(res.bind_password || '')
        setUserSearchBase(res.user_search_base)
        setUserSearchFilter(res.user_search_filter || '(&(objectClass=user)(sAMAccountName={username}))')
        setMailAttribute(res.mail_attribute || 'mail')
        setNameAttribute(res.name_attribute || 'displayName')
        setFallbackToLocal(res.fallback_to_local !== false)
      })
      .catch((err) => {
        toast.error(err.message || 'Failed to load LDAP settings')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const getPayload = () => {
    return {
      enabled,
      server_host: serverHost,
      server_port: Number(serverPort),
      use_ssl: useSsl,
      bind_dn: bindDn,
      bind_password: bindPassword,
      user_search_base: userSearchBase,
      user_search_filter: userSearchFilter,
      mail_attribute: mailAttribute,
      name_attribute: nameAttribute,
      fallback_to_local: fallbackToLocal,
    }
  }

  const handleTest = async () => {
    if (!serverHost) {
      toast.error('Server host is required')
      return
    }
    setTesting(true)
    try {
      const res = await testLDAPConnection(getPayload())
      if (res.result === 'success')
        toast.success('LDAP Connection Test Successful!')
      else
        toast.error('LDAP Connection Test Failed')
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (enabled && !serverHost) {
      toast.error('Server host is required when LDAP is enabled')
      return
    }
    setSaving(true)
    try {
      await saveLDAPSettings(getPayload())
      toast.success('LDAP Settings Saved Successfully')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="system-sm-medium text-text-tertiary">Loading...</span>
      </div>
    )
  }

  return (
    <div className="max-w-[640px]">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between p-4 mb-6 border rounded-xl border-divider-subtle bg-components-panel-bg-blur">
        <div>
          <div className="system-md-semibold text-text-primary">LDAP / Active Directory Authentication</div>
          <div className="system-xs-regular text-text-tertiary">Authenticate users through your corporate directory services</div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-divider rounded-full peer peer-focus:ring-2 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-divider-subtle after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
        </label>
      </div>

      <div className="space-y-4">
        {/* Server & Port */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <div className={labelClassName}>Server Host</div>
            <input
              type="text"
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              placeholder="ldap.company.local or ldaps://ldap.company.local"
              className={inputClassName}
            />
          </div>
          <div>
            <div className={labelClassName}>Port</div>
            <input
              type="number"
              value={serverPort}
              onChange={(e) => setServerPort(Number(e.target.value))}
              placeholder="389"
              className={inputClassName}
            />
          </div>
        </div>

        {/* SSL Configuration */}
        <div className="flex items-center space-x-2 py-2">
          <input
            type="checkbox"
            id="useSsl"
            checked={useSsl}
            onChange={(e) => setUseSsl(e.target.checked)}
            className="rounded border-divider-subtle text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="useSsl" className="system-sm-medium text-text-secondary cursor-pointer">
            Use SSL/TLS (LDAPS)
          </label>
        </div>

        {/* Service Bind DN & Password */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={labelClassName}>Bind DN (Service Account)</div>
            <input
              type="text"
              value={bindDn}
              onChange={(e) => setBindDn(e.target.value)}
              placeholder="cn=ldap-reader,ou=services,dc=company,dc=local"
              className={inputClassName}
            />
          </div>
          <div>
            <div className={labelClassName}>Bind Password</div>
            <input
              type="password"
              value={bindPassword}
              onChange={(e) => setBindPassword(e.target.value)}
              placeholder={bindPassword ? '••••••••' : 'Enter password'}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="border-t border-divider-subtle my-6 pt-4" />

        {/* User Search Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={labelClassName}>User Search Base DN</div>
            <input
              type="text"
              value={userSearchBase}
              onChange={(e) => setUserSearchBase(e.target.value)}
              placeholder="ou=users,dc=company,dc=local"
              className={inputClassName}
            />
          </div>
          <div>
            <div className={labelClassName}>User Search Filter</div>
            <input
              type="text"
              value={userSearchFilter}
              onChange={(e) => setUserSearchFilter(e.target.value)}
              placeholder="(&(objectClass=user)(sAMAccountName={username}))"
              className={inputClassName}
            />
          </div>
        </div>

        {/* Attributes Mapping */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className={labelClassName}>Email Attribute</div>
            <input
              type="text"
              value={mailAttribute}
              onChange={(e) => setMailAttribute(e.target.value)}
              placeholder="mail"
              className={inputClassName}
            />
          </div>
          <div>
            <div className={labelClassName}>Name Attribute</div>
            <input
              type="text"
              value={nameAttribute}
              onChange={(e) => setNameAttribute(e.target.value)}
              placeholder="displayName"
              className={inputClassName}
            />
          </div>
        </div>

        {/* Local database fallback */}
        <div className="flex items-center space-x-2 py-2">
          <input
            type="checkbox"
            id="fallbackToLocal"
            checked={fallbackToLocal}
            onChange={(e) => setFallbackToLocal(e.target.checked)}
            className="rounded border-divider-subtle text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="fallbackToLocal" className="system-sm-medium text-text-secondary cursor-pointer">
            Fallback to local database authentication on failure
          </label>
        </div>

        {/* Buttons */}
        <div className="flex space-x-3 pt-6">
          <Button
            type="button"
            variant="secondary"
            disabled={testing || saving}
            onClick={handleTest}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={testing || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}
