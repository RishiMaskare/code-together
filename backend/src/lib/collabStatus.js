export const ACTIVE_COLLAB_STATUSES = Object.freeze(["accepted", "active"]);

export const isCollabActive = (status) => ACTIVE_COLLAB_STATUSES.includes(status);
