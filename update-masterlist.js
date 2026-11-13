#!/usr/bin/env node
import { readFile, writeFile } from 'fs/promises'
import chalk from 'chalk'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseToml } from 'smol-toml'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url)))
const USER_AGENT = `${pkg.name}/${pkg.version} (RimWorld mod metadata fetcher)`
const MODS_FILE = new URL('./mods.json', import.meta.url)

const MASTERLIST_PROJECT = 'AblativeAbsolute/libidinous_loader_providers'
const MASTERLIST_FILE = 'providers.toml'
const MASTERLIST_REF = 'v1'
const SUPPORTED_MASTERLIST_VERSION = 1

const REQUEST_TIMEOUT_MS = 5000
const DEFAULT_RETRY_AFTER_SECONDS = 10
const MAX_RETRY_WAIT_SECONDS = 60
const MAX_DEFERRAL_ROUNDS = 3

const DEFAULT_MAX_WAIT_SECONDS = 300

const skipVersions = process.argv.includes('--skip-versions') || process.argv.includes('-s')
const maxWaitSeconds = parseMaxWait(process.argv)

/** Read `--max-wait <seconds>`: the longest a retry round may wait for one rate-limited host. */
function parseMaxWait(argv) {
    const index = argv.indexOf('--max-wait')
    if (index < 0) return DEFAULT_MAX_WAIT_SECONDS
    const value = Number(argv[index + 1])
    if (!Number.isFinite(value) || value < 0) {
        console.error(chalk.red`--max-wait needs a number of seconds, got "${argv[index + 1]}"`)
        process.exit(1)
    }
    return value
}

// --- helpers -----------------------------------------------------------------

function buildGitLabApiUrl(host, projectPath, filePath, ref) {
    const project = encodeURIComponent(projectPath)
    const file = encodeURIComponent(filePath)
    return `https://${host}/api/v4/projects/${project}/repository/files/${file}/raw?ref=${encodeURIComponent(ref)}`
}

/** Normalise a git remote so `https://host/a/b.git`, `https://host/a/b` and `https://host/a/b/` compare equal. */
function normalizeRemote(url) {
    return url.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '')
}

function titleCase(value) {
    return value.replace(/[-_]/g, ' ').replace(/(^\w)|(\s+\w)/g, letter => letter.toUpperCase())
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function parseRetryAfter(header) {
    if (!header) return null
    const seconds = Number(header)
    if (!Number.isNaN(seconds)) return seconds
    const dateMs = Date.parse(header)
    if (!Number.isNaN(dateMs)) return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000))
    return null
}

/**
 * Fetch a URL as text. Throws on non-200 responses, redirects (often login pages)
 * and timeouts. A 429 throws an error with `code = 'RATE_LIMITED'` and `retryAfter`.
 */
async function fetchText(url) {
    let response
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'manual',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    } catch (err) {
        if (err.name === 'TimeoutError') throw new Error(`Request timeout (${REQUEST_TIMEOUT_MS / 1000}s)`)
        throw err
    }

    if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication required (${response.status})`)
    }
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') ?? ''
        if (/login|signin|sign_in|auth/.test(location)) throw new Error('Redirect to login page detected')
        throw new Error(`Unexpected redirect (${response.status})`)
    }
    if (response.status === 429) {
        const err = new Error('HTTP 429')
        err.code = 'RATE_LIMITED'
        err.retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        throw err
    }
    if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
    }
    return response.text()
}

/** Hosts that asked us to back off longer than MAX_RETRY_WAIT_SECONDS, mapped to when the block ends (ms epoch). */
const exhaustedHosts = new Map()

function secondsUntil(timestampMs) {
    return Math.max(0, Math.ceil((timestampMs - Date.now()) / 1000))
}

/** Error for a host that is blocked until `resumeAt`; callers can defer the work instead of failing it. */
function hostExhaustedError(host, resumeAt) {
    const err = new Error(`Rate limited by ${host}, retry in ${secondsUntil(resumeAt)}s`)
    err.code = 'HOST_EXHAUSTED'
    err.host = host
    err.resumeAt = resumeAt
    return err
}

async function fetchTextWithRetry(url, retriesLeft = 1) {
    const host = new URL(url).hostname
    const blockedUntil = exhaustedHosts.get(host)
    if (blockedUntil !== undefined) {
        if (blockedUntil > Date.now()) throw hostExhaustedError(host, blockedUntil)
        exhaustedHosts.delete(host)
    }

    try {
        return await fetchText(url)
    } catch (err) {
        if (err.code !== 'RATE_LIMITED') throw err

        const delaySeconds = err.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS
        if (retriesLeft > 0 && delaySeconds <= MAX_RETRY_WAIT_SECONDS) {
            console.log(chalk.gray`  ⏸ Rate limited, sleeping ${delaySeconds}s before retry...`)
            await sleep(delaySeconds * 1000)
            return fetchTextWithRetry(url, retriesLeft - 1)
        }

        const resumeAt = Date.now() + delaySeconds * 1000
        exhaustedHosts.set(host, resumeAt)
        console.log(chalk.red`  ⛔ ${host} rate limit exhausted (retry after ${delaySeconds}s), deferring its requests`)
        throw hostExhaustedError(host, resumeAt)
    }
}

// --- About.xml version lookup ------------------------------------------------

/**
 * Build the candidate raw About.xml URLs for a git remote, in the order to try them.
 * Without an explicit branch both `master` and `main` are tried.
 */
function aboutXmlUrls(gitUrl, branch) {
    const url = new URL(gitUrl)
    const projectPath = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
    const host = url.hostname

    let build
    let defaultRefs
    if (host === 'gitgud.io' || host === 'gitlab.com') {
        // GitLab API instead of /-/raw/ to avoid the Cloudflare challenge on gitgud.io
        build = ref => buildGitLabApiUrl(host, projectPath, 'About/About.xml', ref)
        defaultRefs = host === 'gitgud.io' ? ['master', 'main'] : ['main', 'master']
    } else if (host === 'github.com') {
        build = ref => `https://raw.githubusercontent.com/${projectPath}/${ref}/About/About.xml`
        defaultRefs = ['master', 'main']
    } else if (host === 'codeberg.org') {
        build = ref => `https://codeberg.org/${projectPath}/raw/branch/${ref}/About/About.xml`
        defaultRefs = ['main', 'master']
    } else {
        throw new Error(`Unsupported git hosting platform: ${host}`)
    }

    return (branch ? [branch] : defaultRefs).map(build)
}

function parseSupportedVersions(xml) {
    let about
    try {
        about = new XMLParser().parse(xml)
    } catch (err) {
        throw new Error(`Failed to parse XML: ${err.message}`)
    }
    const versions = about?.ModMetaData?.supportedVersions?.li
    if (versions === undefined) throw new Error('No supportedVersions found in About.xml')
    return Array.isArray(versions) ? versions : [versions]
}

async function fetchModVersions(gitUrl, branch) {
    const errors = []
    for (const url of aboutXmlUrls(gitUrl, branch)) {
        try {
            return parseSupportedVersions(await fetchTextWithRetry(url))
        } catch (err) {
            // A blocked host fails every ref the same way; let the caller defer the whole mod
            if (err.code === 'HOST_EXHAUSTED') throw err
            errors.push(err.message)
        }
    }
    throw new Error(errors.length > 1 ? `Failed all branches: ${errors.join(', ')}` : errors[0])
}

// --- masterlist merge --------------------------------------------------------

async function downloadMasterlist() {
    const url = buildGitLabApiUrl('gitgud.io', MASTERLIST_PROJECT, MASTERLIST_FILE, MASTERLIST_REF)
    const masterlist = parseToml(await fetchTextWithRetry(url))

    if (masterlist.version !== SUPPORTED_MASTERLIST_VERSION) {
        console.warn(chalk.yellow`Masterlist version is ${masterlist.version}, this script expects ${SUPPORTED_MASTERLIST_VERSION}. Results may be wrong.`)
    }
    if (!masterlist.providers || typeof masterlist.providers !== 'object') {
        throw new Error('Masterlist has no [providers] table')
    }
    return masterlist
}

/**
 * Merge masterlist providers into the local registry, in place.
 * - Only `type = "git"` providers are used; the installer cannot handle zip downloads.
 * - Disabled providers are never added. Existing entries that upstream disabled are reported, not changed.
 * - Existing entries keep their curated label, name and remark; only missing fields are filled in.
 * - An upstream `branch` always overwrites the local one.
 */
function mergeProviders(registry, providers) {
    const stats = { added: 0, updated: 0, unchanged: 0, skippedNonGit: 0, skippedDisabled: 0 }
    const disabledUpstream = []

    for (const [category, mods] of Object.entries(providers)) {
        const entries = Object.entries(mods)
        const categoryRemark = titleCase(category)
        console.log(chalk.yellow`Checking ${category}: ${entries.length} mods`)

        for (const [key, info] of entries) {
            const displayName = info.display_name ?? info.name ?? key

            if (info.type !== 'git') {
                stats.skippedNonGit++
                console.info(chalk.gray`\t${displayName} skipped (type ${info.type})`)
                continue
            }
            if (!info.url) {
                console.warn(chalk.red`\t${displayName} skipped (no url)`)
                continue
            }

            const remote = normalizeRemote(info.url)
            const index = registry.findIndex(m => m.remote && normalizeRemote(m.remote) === remote)

            if (index < 0) {
                if (info.disabled) {
                    stats.skippedDisabled++
                    console.info(chalk.gray`\t${displayName} skipped (disabled upstream)`)
                    continue
                }
                const entry = {
                    name: info.name ?? key,
                    label: info.display_name ?? titleCase(info.name ?? key),
                    remote: info.url,
                    remark: categoryRemark,
                }
                if (info.branch) entry.branch = info.branch
                registry.push(entry)
                stats.added++
                console.info(chalk.green`\t${entry.label} added`)
                continue
            }

            const existing = registry[index]
            const updated = {
                ...existing,
                name: existing.name ?? info.name ?? key,
                label: existing.label ?? info.display_name ?? titleCase(info.name ?? key),
                remark: existing.remark || categoryRemark,
            }
            // The masterlist is authoritative for branches; local pins only survive when upstream sets none
            if (info.branch) updated.branch = info.branch

            const changed = ['name', 'label', 'remark', 'branch'].some(field => updated[field] !== existing[field])
            registry[index] = updated

            if (info.disabled && !existing.deprecated) {
                disabledUpstream.push(updated.label)
            }

            if (changed) {
                stats.updated++
                console.info(chalk.yellow`\t${updated.label} => ${displayName} updated`)
            } else {
                stats.unchanged++
                console.info(chalk.white`\t${updated.label} => ${displayName} unchanged`)
            }
        }
    }

    return { stats, disabledUpstream }
}

/**
 * Fold entries for repositories that moved. When an active entry's remote is no longer upstream and an
 * upstream entry has the same folder name, the old entry takes over the new remote, branch and versions,
 * records its old remote in `previousRemotes`, and the duplicate upstream entry is removed.
 * The old entry keeps its position, label and remark. Returns the moves as `{ name, from, to }`.
 */
function foldMovedEntries(registry, providers) {
    const upstreamRemotes = new Set()
    for (const mods of Object.values(providers)) {
        for (const info of Object.values(mods)) {
            if (info.url) upstreamRemotes.add(normalizeRemote(info.url))
        }
    }
    const isUpstream = mod => upstreamRemotes.has(normalizeRemote(mod.remote))

    const moves = []
    const removed = new Set()
    for (const current of registry) {
        if (current.deprecated || !isUpstream(current)) continue

        const stale = registry.filter(m =>
            m !== current && !removed.has(m) && !m.deprecated && m.name === current.name && !isUpstream(m)
        )
        // Only fold an unambiguous move: one stale entry for one upstream entry
        if (stale.length !== 1) continue
        const old = stale[0]

        const previousRemotes = [...(old.previousRemotes ?? []), ...(current.previousRemotes ?? []), old.remote]
        const folded = {
            ...old,
            remote: current.remote,
            previousRemotes: previousRemotes.filter((r, i) =>
                previousRemotes.findIndex(other => normalizeRemote(other) === normalizeRemote(r)) === i
            ),
        }
        if (current.branch) folded.branch = current.branch
        else delete folded.branch
        if (current.supportedVersions) folded.supportedVersions = current.supportedVersions

        registry[registry.indexOf(old)] = folded
        removed.add(current)
        moves.push({ name: old.name, from: old.remote, to: current.remote })
    }

    for (let i = registry.length - 1; i >= 0; i--) {
        if (removed.has(registry[i])) registry.splice(i, 1)
    }
    return moves
}

async function updateVersions(registry) {
    console.log(chalk.cyan`\nFetching version information for ${registry.length} mods...`)
    console.log(chalk.gray`(Use --skip-versions or -s to skip this step, --max-wait <seconds> to change the ${maxWaitSeconds}s rate-limit wait cap)\n`)

    let successCount = 0
    const failures = []

    /** Fetch one mod's versions. Returns a deferral `{ index, host, resumeAt }` when its host is rate limited. */
    const processMod = async (index) => {
        const mod = registry[index]
        try {
            const versions = await fetchModVersions(mod.remote, mod.branch)
            registry[index] = { ...mod, supportedVersions: versions }
            successCount++
            console.log(chalk.green`✓ ${mod.label.padEnd(50)} ${chalk.yellow`[${versions.join(', ')}]`}`)
            return null
        } catch (err) {
            if (err.code === 'HOST_EXHAUSTED') {
                console.log(chalk.gray`⏳ ${mod.label.padEnd(50)} (deferred, ${err.host} resumes in ${secondsUntil(err.resumeAt)}s)`)
                return { index, host: err.host, resumeAt: err.resumeAt, error: err.message }
            }
            failures.push({ mod: mod.label, error: err.message })
            console.log(chalk.red`✗ ${mod.label.padEnd(50)} ${chalk.gray`(${err.message})`}`)
            return null
        }
    }

    let deferred = []
    for (let i = 0; i < registry.length; i++) {
        if (registry[i].deprecated || !registry[i].remote) continue
        const deferral = await processMod(i)
        if (deferral) deferred.push(deferral)
    }

    // Retry rate-limited mods once their host's Retry-After has passed, earliest host first
    for (let round = 1; round <= MAX_DEFERRAL_ROUNDS && deferred.length > 0; round++) {
        console.log(chalk.cyan`\nRetry round ${round}/${MAX_DEFERRAL_ROUNDS}: ${deferred.length} deferred mods`)
        deferred.sort((a, b) => a.resumeAt - b.resumeAt)

        const next = []
        const reblocked = new Set()
        for (const item of deferred) {
            // Host blocked us again this round: wait once in the next round instead of once per mod
            if (reblocked.has(item.host)) {
                next.push(item)
                continue
            }

            const resumeAt = exhaustedHosts.get(item.host) ?? item.resumeAt
            const waitSeconds = secondsUntil(resumeAt)
            if (waitSeconds > maxWaitSeconds) {
                const resumeTime = new Date(resumeAt).toLocaleTimeString()
                failures.push({
                    mod: registry[item.index].label,
                    error: `${item.host} rate limited until ${resumeTime} (${waitSeconds}s, over --max-wait ${maxWaitSeconds}s)`,
                })
                continue
            }
            if (waitSeconds > 0) {
                console.log(chalk.gray`  ⏸ Waiting ${waitSeconds}s for ${item.host} to accept requests again...`)
                await sleep(resumeAt - Date.now())
            }

            const deferral = await processMod(item.index)
            if (deferral) {
                reblocked.add(deferral.host)
                next.push(deferral)
            }
        }
        deferred = next
    }

    for (const item of deferred) {
        failures.push({ mod: registry[item.index].label, error: `${item.error} (gave up after ${MAX_DEFERRAL_ROUNDS} retry rounds)` })
    }

    const tooLong = failures.filter(f => f.error.includes('over --max-wait'))
    if (tooLong.length > 0) {
        console.log(chalk.yellow`\n${tooLong.length} mods skipped because their host's rate limit outlasts --max-wait; they keep their previous versions.`)
    }

    console.log(chalk.cyan`\nVersion fetch summary:`)
    console.log(chalk.green`  ✓ Success: ${successCount} mods`)
    if (failures.length > 0) {
        console.log(chalk.red`  ✗ Failed: ${failures.length} mods`)
        console.log(chalk.gray`\n${failures.length > 5 ? 'Showing first 5 failed mods' : 'Failed mods'}:`)
        failures.slice(0, 5).forEach(({ mod, error }) => console.log(chalk.gray`  - ${mod}: ${error}`))
        if (failures.length > 5) console.log(chalk.gray`  ... and ${failures.length - 5} more`)
    }
}

// --- main --------------------------------------------------------------------

async function main() {
    if (skipVersions) {
        console.log(chalk.cyan`Skipping version fetching (--skip-versions flag detected)`)
    }

    /** @type {Array<Record<string, unknown>>} */
    const registry = JSON.parse(await readFile(MODS_FILE, 'utf8'))

    const masterlist = await downloadMasterlist()
    console.log(chalk.green`Downloaded masterlist (${MASTERLIST_FILE}@${MASTERLIST_REF})`)

    const { stats, disabledUpstream } = mergeProviders(registry, masterlist.providers)
    const moves = foldMovedEntries(registry, masterlist.providers)

    console.log(chalk.cyan`\nMasterlist summary:`)
    console.log(chalk.green`  + Added:     ${stats.added}`)
    console.log(chalk.yellow`  ~ Updated:   ${stats.updated}`)
    console.log(chalk.white`  = Unchanged: ${stats.unchanged}`)
    console.log(chalk.gray`  - Skipped:   ${stats.skippedNonGit} non-git, ${stats.skippedDisabled} disabled`)
    if (disabledUpstream.length > 0) {
        console.log(chalk.yellow`\nDisabled upstream but still active in mods.json (consider marking deprecated):`)
        disabledUpstream.forEach(label => console.log(chalk.yellow`  - ${label}`))
    }
    if (moves.length > 0) {
        console.log(chalk.cyan`\nMoved repositories (${moves.length}); installs on the old remote can be relinked with \`rw-lazy-installer check\`:`)
        moves.forEach(({ name, from, to }) => console.log(chalk.cyan`  - ${name}: ${from} → ${to}`))
    }

    const byName = new Map()
    for (const mod of registry) {
        if (mod.deprecated) continue
        byName.set(mod.name, [...(byName.get(mod.name) ?? []), mod.remote])
    }
    const collisions = [...byName].filter(([, remotes]) => remotes.length > 1)
    if (collisions.length > 0) {
        console.log(chalk.red`\nActive entries sharing an install folder (upstream likely moved the repository):`)
        collisions.forEach(([name, remotes]) => console.log(chalk.red`  - ${name}: ${remotes.join(', ')}`))
    }

    if (skipVersions) {
        console.log(chalk.cyan`\nSkipped version fetching`)
    } else {
        await updateVersions(registry)
    }

    await writeFile(MODS_FILE, JSON.stringify(registry, null, 2))
    console.log(chalk.green`\nFinished updating mods.json\n`)
}

main().catch(err => {
    console.error(chalk.red`Masterlist update failed: ${err.message}`)
    process.exitCode = 1
})
