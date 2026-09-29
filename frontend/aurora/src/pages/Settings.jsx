import { useState } from 'react'
import {
  User,
  Bell,
  Map,
  Ruler,
  Sun,
  Moon,
  RefreshCw,
  Save,
  Check,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { Field, SelectField, Toggle } from '../components/ui/Forms'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

export default function Settings() {
  const { user } = useAuth()
  const { dark, toggleTheme } = useTheme()
  const [saved, setSaved] = useState(false)

  const [profile, setProfile] = useState({
    name: user?.name ?? 'Admin User',
    email: user?.email ?? 'admin@aurora.local',
    organization: user?.organization ?? 'NCPOR (Demo)',
    role: user?.role ?? 'Operations Officer',
  })

  const [notif, setNotif] = useState({
    iceberg: true,
    ice: true,
    weather: true,
    dataQuality: true,
    dailyDigest: false,
  })

  const [map, setMap] = useState({
    darkBasemap: true,
    seaIceOverlay: true,
    showRoutes: true,
    showStations: true,
  })

  const [prefs, setPrefs] = useState({
    units: 'Nautical (kn, nm)',
    riskThreshold: 'Moderate',
    refresh: '5 min',
    theme: dark ? 'Dark navy' : 'Light',
  })

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggle = (obj, setter) => (key) => setter((o) => ({ ...o, [key]: !o[key] }))

  const notifList = [
    ['iceberg', 'Iceberg alerts', 'Icebergs entering a buffer around active routes'],
    ['ice', 'Sea-ice alerts', 'Concentration threshold breaches on monitored corridors'],
    ['weather', 'Weather alerts', 'Storm-level wind and sea-state advisories'],
    ['dataQuality', 'Data quality alerts', 'Missing or stale feeds across the platform'],
    ['dailyDigest', 'Daily operations digest', 'A single summary email each morning (demo)'],
  ]

  const mapList = [
    ['darkBasemap', 'Dark polar basemap', 'Use the night-operations map style'],
    ['seaIceOverlay', 'Sea-ice overlay', 'Show simulated concentration patches'],
    ['showRoutes', 'Show navigation routes', 'Display route alternatives on maps'],
    ['showStations', 'Show research stations', 'Display Bharati, Maitri and Cape Town markers'],
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Configure your profile, notifications, maps, units and demo operation preferences."
        actions={
          <Button onClick={save}>
            {saved ? <><Check size={15} /> Saved</> : <><Save size={15} /> Save changes</>}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <Card>
          <Card.Header title="User Profile" subtitle="Your identity on the platform" icon={User} />
          <Card.Body className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan to-ocean text-xl font-bold text-navy">
                {profile.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{profile.name}</p>
                <p className="text-xs text-mist">{profile.role}</p>
                <span className="mt-1 inline-block rounded-full bg-safe/10 px-2 py-0.5 text-[10px] font-medium text-safe">Demo account</span>
              </div>
            </div>
            <Field label="Full name">
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </Field>
            <Field label="Organization">
              <input className="input" value={profile.organization} onChange={(e) => setProfile({ ...profile, organization: e.target.value })} />
            </Field>
          </Card.Body>
        </Card>

        {/* Notifications */}
        <Card>
          <Card.Header title="Notification Preferences" subtitle="Choose which signals reach you" icon={Bell} />
          <Card.Body className="space-y-3">
            {notifList.map(([key, label, desc]) => (
              <Toggle key={key} checked={notif[key]} onChange={() => toggle(notif, setNotif)(key)} label={label} description={desc} />
            ))}
          </Card.Body>
        </Card>

        {/* Map preferences */}
        <Card>
          <Card.Header title="Map Preferences" subtitle="How the operational map is rendered" icon={Map} />
          <Card.Body className="space-y-3">
            {mapList.map(([key, label, desc]) => (
              <Toggle key={key} checked={map[key]} onChange={() => toggle(map, setMap)(key)} label={label} description={desc} />
            ))}
          </Card.Body>
        </Card>

        {/* Units, theme, risk, refresh */}
        <Card>
          <Card.Header title="Units, Theme & Operations" subtitle="General preferences" icon={Ruler} />
          <Card.Body className="space-y-4">
            <SelectField
              label="Measurement units"
              value={prefs.units}
              onChange={(v) => setPrefs({ ...prefs, units: v })}
              options={[
                { value: 'Nautical (kn, nm)', label: 'Nautical (kn, nm)' },
                { value: 'Metric (km/h, km)', label: 'Metric (km/h, km)' },
                { value: 'Imperial (mph, mi)', label: 'Imperial (mph, mi)' },
              ]}
            />
            <SelectField
              label="Risk threshold"
              value={prefs.riskThreshold}
              onChange={(v) => setPrefs({ ...prefs, riskThreshold: v })}
              options={[
                { value: 'Low', label: 'Low — flag early' },
                { value: 'Moderate', label: 'Moderate — balanced' },
                { value: 'High', label: 'High — reduced noise' },
              ]}
            />
            <SelectField
              label="Data refresh"
              value={prefs.refresh}
              onChange={(v) => setPrefs({ ...prefs, refresh: v })}
              options={[
                { value: '1 min', label: '1 minute (simulated)' },
                { value: '5 min', label: '5 minutes' },
                { value: '15 min', label: '15 minutes' },
                { value: 'Manual', label: 'Manual only' },
              ]}
            />
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-navy-deep/50 px-4 py-3">
              <div className="flex items-center gap-3">
                {dark ? <Sun size={18} className="text-warn" /> : <Moon size={18} className="text-cyan" />}
                <div>
                  <p className="text-sm font-medium text-white/85">Dashboard theme</p>
                  <p className="text-xs text-mist">Currently {dark ? 'Dark navy' : 'Light'}</p>
                </div>
              </div>
              <button role="switch" aria-checked={dark} onClick={toggleTheme} className={`relative h-6 w-11 rounded-full transition ${dark ? 'bg-cyan' : 'bg-white/10'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${dark ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          </Card.Body>
        </Card>
      </div>

      <Card>
        <Card.Body className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/10 text-cyan"><RefreshCw size={18} /></div>
            <div>
              <p className="text-sm font-semibold text-white">Data refresh preferences</p>
              <p className="text-xs text-mist">Simulated refresh cadence applied to demo feeds only.</p>
            </div>
          </div>
          <Button onClick={save}>{saved ? <><Check size={15} /> Saved</> : <><Save size={15} /> Save changes</>}</Button>
        </Card.Body>
      </Card>
    </div>
  )
}