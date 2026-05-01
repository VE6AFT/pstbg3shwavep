import {
  json,
  ensureStaticNowRow,
  publicLayoutTab,
  readAuthorIdHeader,
  readTabCreationLimit,
  parseLayoutTabRequest,
  STATIC_NOW_TAB_ID,
  STATIC_NOW_TAB_NAME,
  tabCreationLimitResponse,
  validationErrorResponse,
  ValidationError,
  type Env,
  type LayoutTab,
} from "../_shared";

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

    if (body.tab.id === STATIC_NOW_TAB_ID || body.tab.name === STATIC_NOW_TAB_NAME) {
      return json({ error: "The Now tab is static and cannot be cloned into place" }, { status: 400 });
    }

    const creationLimit = await readTabCreationLimit(env.DB, authorId);
    if (creationLimit) {
      return tabCreationLimitResponse(creationLimit);
    }

    const updatedAt = new Date().toISOString();
    const tab: LayoutTab = {
      ...body.tab,
      authorId,
      canEdit: true,
      createdAt: updatedAt,
      updatedAt,
    };

    if (tab.clonedFromId === STATIC_NOW_TAB_ID) {
      await ensureStaticNowRow(env.DB);
    }

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
