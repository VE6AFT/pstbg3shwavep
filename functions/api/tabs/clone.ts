import {
  json,
  publicLayoutTab,
  readAuthorIdHeader,
  parseLayoutTabRequest,
  validationErrorResponse,
  ValidationError,
  type Env,
  type LayoutTab,
} from "../_shared";

const TAB_LIMIT = 20;

type CloneBody = {
  tab: LayoutTab;
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  try {
    const body: CloneBody = {
      tab: await parseLayoutTabRequest(request, { root: "tab" }),
    };

    // Enforce per-author tab limit
    const authorId = readAuthorIdHeader(request);
    if (!authorId) {
      return json({ error: "Missing author id" }, { status: 400 });
    }

    const limitRow = await env.DB
      .prepare(`SELECT 1 AS hit FROM tabs WHERE author_id = ? LIMIT 1 OFFSET ?`)
      .bind(authorId, TAB_LIMIT - 1)
      .first<{ hit: number }>();

    if (limitRow) {
      return json(
        { error: `tab limit reached (${TAB_LIMIT} max per user)` },
        { status: 429 },
      );
    }

    const updatedAt = new Date().toISOString();
    const tab: LayoutTab = {
      ...body.tab,
      authorId,
      canEdit: true,
      createdAt: updatedAt,
      updatedAt,
    };

    await env.DB.prepare(
      `INSERT INTO tabs
        (id, name, author_id, cloned_from_tab_id, layout_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(tab.id, tab.name, tab.authorId ?? null, tab.clonedFromId ?? null, JSON.stringify(tab.layout), updatedAt, updatedAt)
      .run();

    return json({ tab: publicLayoutTab(tab) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : "Unable to clone tab";
    return json({ error: message }, { status: 400 });
  }
};
