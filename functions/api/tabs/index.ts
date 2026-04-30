import { json, readAuthorIdHeader, readLayoutTab, type Env, type TabRow } from "../_shared";

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
      tabs.cloned_from_tab_id,
      cloned_from.name AS cloned_from_tab_name,
      tabs.layout_json,
      tabs.created_at,
      tabs.updated_at
    FROM tabs
    LEFT JOIN tabs AS cloned_from ON cloned_from.id = tabs.cloned_from_tab_id
    ORDER BY
      CASE WHEN tabs.id = 'tab-default' THEN 0 ELSE 1 END,
      tabs.created_at ASC,
      tabs.name ASC`,
  ).bind(authorId).all<TabRow>();

  return json({ tabs: results.map(readLayoutTab) });
};
