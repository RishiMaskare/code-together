export const safeUserFields = [
  "_id",
  "fullName",
  "email",
  "bio",
  "profilePic",
  "gainedSkills",
  "learningSkills",
  "location",
  "isOnboarded",
  "friends",
  "githubUsername",
  "createdAt",
];

export const safeUserProjection = safeUserFields.join(" ");

export function serializeSafeUser(user) {
  if (!user) return null;

  const source = typeof user.toObject === "function" ? user.toObject() : user;

  return Object.fromEntries(
    safeUserFields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]])
  );
}
