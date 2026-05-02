import { json, readAuthorIdHeader, readLayoutTab, STATIC_NOW_TAB_ID, type Env, type TabRow } from "../_shared";

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const authorId = readAuthorIdHeader(request);
  const { results } = await env.DB.prepare(
    `SELECT
      tabs.id,
      tabs.name,
      CASE
        WHEN tabs.author_id IS NOT NULL AND tabs.author_id = ? THEN 1
        ELSE 0
      END AS can_edit,
      tabs.created_at,
      tabs.updated_at
    FROM tabs
    ORDER BY
      CASE WHEN tabs.id = ? THEN 0 ELSE 1 END,
      tabs.created_at ASC,
      tabs.name ASC`,
  ).bind(authorId, STATIC_NOW_TAB_ID).all<TabRow>();

  return json({ tabs: results.map(readLayoutTab) });
};
