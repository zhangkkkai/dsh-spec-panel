/**
 * A tiny, safe Markdown renderer for spec artifacts.
 *
 * Deliberately minimal: headings, bold / inline code, fenced code, bullet
 * lists, task checkboxes, and paragraphs. It never injects raw HTML — every
 * token becomes a React text/leaf node, so untrusted spec files cannot
 * execute script in the sidebar.
 */
import type { ReactNode } from 'react'
import styles from './spec.module.css'

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<code key={key++} className={styles.inlineCode}>{token.slice(1, -1)}</code>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

interface ListItem {
  readonly checked: boolean | null
  readonly text: string
  readonly key: number
}

/** Render `content` as structured Markdown (safe, no HTML passthrough). */
export function Markdown({ content }: { readonly content: string }) {
  const lines = content.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const listItems: ListItem[] = []
  let key = 0
  let inCode = false
  let codeLines: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={key++} className={styles.mdList}>
        {listItems.map((item) => (
          <li key={item.key} className={item.checked === null ? undefined : styles.mdTask}>
            {item.checked !== null && (
              <span className={item.checked ? styles.mdChecked : styles.mdUnchecked}>
                {item.checked ? '✓' : ''}
              </span>
            )}
            <span>{parseInline(item.text)}</span>
          </li>
        ))}
      </ul>,
    )
    listItems.length = 0
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line.startsWith('```')) {
      flushList()
      if (inCode) {
        blocks.push(<pre key={key++} className={styles.codeBlock}><code>{codeLines.join('\n')}</code></pre>)
        codeLines = []
        inCode = false
      } else {
        inCode = true
      }
      i += 1
      continue
    }
    if (inCode) {
      codeLines.push(line)
      i += 1
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushList()
      const level = heading[1]?.length ?? 2
      const text = heading[2] ?? ''
      if (level === 1) {
        blocks.push(<h1 key={key++} className={styles.h1}>{parseInline(text)}</h1>)
      } else if (level === 2) {
        blocks.push(<h2 key={key++} className={styles.h2}>{parseInline(text)}</h2>)
      } else if (level === 3) {
        blocks.push(<h3 key={key++} className={styles.h3}>{parseInline(text)}</h3>)
      } else {
        blocks.push(<h4 key={key++} className={styles.h4}>{parseInline(text)}</h4>)
      }
      i += 1
      continue
    }

    const task = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task !== null) {
      const marker = task[1] ?? ' '
      listItems.push({ checked: marker.toLowerCase() === 'x', text: task[2] ?? '', key: key++ })
      i += 1
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      listItems.push({ checked: null, text: bullet[1] ?? '', key: key++ })
      i += 1
      continue
    }

    if (line.trim() === '') {
      flushList()
      i += 1
      continue
    }

    flushList()
    blocks.push(<p key={key++} className={styles.paragraph}>{parseInline(line)}</p>)
    i += 1
  }
  flushList()
  if (inCode) {
    blocks.push(<pre key={key++} className={styles.codeBlock}><code>{codeLines.join('\n')}</code></pre>)
  }

  return <div className={styles.md}>{blocks}</div>
}
