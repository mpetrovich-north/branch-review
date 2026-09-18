import { z } from 'zod'

export const lineTypeSchema = z.enum(['added', 'removed', 'unchanged'])

export const lineCommentSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('line'),
  commitSha: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  lineType: lineTypeSchema,
  snippet: z.string().optional(),
  body: z.string().min(1),
  createdAt: z.string().datetime(),
})

export const commitMessageCommentSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('commit_message'),
  commitSha: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.string().datetime(),
})

export const commentSchema = z.discriminatedUnion('kind', [
  lineCommentSchema,
  commitMessageCommentSchema,
])

export const commentsFileSchema = z.object({
  version: z.literal(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  updatedAt: z.string().datetime(),
  comments: z.array(commentSchema),
})

export const configSchema = z.object({
  baseBranch: z.string().min(1),
})

export const createLineCommentSchema = z.object({
  kind: z.literal('line'),
  commitSha: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  lineType: lineTypeSchema,
  snippet: z.string().optional(),
  body: z.string().min(1),
})

export const createCommitMessageCommentSchema = z.object({
  kind: z.literal('commit_message'),
  commitSha: z.string().min(1),
  body: z.string().min(1),
})

export const createCommentSchema = z.discriminatedUnion('kind', [
  createLineCommentSchema,
  createCommitMessageCommentSchema,
])

export type Comment = z.infer<typeof commentSchema>
export type CommentsFile = z.infer<typeof commentsFileSchema>
export type ReviewConfig = z.infer<typeof configSchema>
export type LineType = z.infer<typeof lineTypeSchema>
