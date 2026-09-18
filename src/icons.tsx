import type { ReactNode } from 'react'
import type { DiffFile } from './types'

type IconProps = {
  className?: string
  title?: string
}

function Svg({
  children,
  className,
  title,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M1.5 4h4l1 1.25H14.5v7.25a1.25 1.25 0 0 1-1.25 1.25H2.75A1.25 1.25 0 0 1 1.5 12.5V4Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M3.75 1.75h5.19L12.25 5.06v9.19a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M8.75 1.75V4.5a1 1 0 0 0 1 1h2.75"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function StatusAddedIcon(props: IconProps) {
  return (
    <Svg {...props} title={props.title ?? 'Added'}>
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function StatusDeletedIcon(props: IconProps) {
  return (
    <Svg {...props} title={props.title ?? 'Deleted'}>
      <path
        d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  )
}

/** Stacked +/- like GitHub’s modified marker. */
export function StatusModifiedIcon(props: IconProps) {
  return (
    <Svg {...props} title={props.title ?? 'Modified'}>
      <path
        d="M8 2.75v4.5M5.75 5h4.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M5.5 11.25h5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function StatusRenamedIcon(props: IconProps) {
  return (
    <Svg {...props} title={props.title ?? 'Renamed'}>
      <path
        d="M2.75 8h8.5M8.5 4.75 11.75 8 8.5 11.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function StatusIcon({
  status,
  className,
}: {
  status: DiffFile['status']
  className?: string
}) {
  switch (status) {
    case 'added':
      return <StatusAddedIcon className={className} />
    case 'deleted':
      return <StatusDeletedIcon className={className} />
    case 'renamed':
      return <StatusRenamedIcon className={className} />
    default:
      return <StatusModifiedIcon className={className} />
  }
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M12.6 3.4l-1.06 1.06M4.46 11.54l-1.06 1.06"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12.6 10.2A5.25 5.25 0 0 1 5.8 3.4 5.5 5.5 0 1 0 12.6 10.2Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
