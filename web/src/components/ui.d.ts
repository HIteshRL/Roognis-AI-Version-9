/**
 * Types for the existing `ui.jsx` primitives. New TypeScript features reuse
 * these rather than re-implementing buttons, badges, modals or toasts.
 */
import type { ReactNode } from 'react'

export type BadgeTone = 'default' | 'primary' | 'success' | 'warn' | 'danger'

export declare function Avatar(props: {
  name?: string | null
  id?: string | null
  size?: 'sm' | 'md' | 'lg'
}): JSX.Element

export declare function Badge(props: {
  children?: ReactNode
  tone?: BadgeTone
  dot?: boolean
}): JSX.Element

export declare function Spinner(props: { size?: number }): JSX.Element

export declare function Loading(props: { label?: string }): JSX.Element

export declare function EmptyState(props: {
  icon?: ReactNode
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
}): JSX.Element

export declare function Modal(props: {
  open: boolean
  onClose?: () => void
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  wide?: boolean
}): JSX.Element | null

export declare function ToastProvider(props: { children?: ReactNode }): JSX.Element

export interface Toast {
  show: (message: string) => void
  success: (message: string) => void
  error: (message: string) => void
}

export declare function useToast(): Toast
