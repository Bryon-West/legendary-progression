function nameParts(value?: string | null): string[] {
  return (value ?? "").trim().split(/\s+/).filter(Boolean);
}

function initialsFromParts(parts: string[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts.at(-1)?.slice(0, 1) ?? ''}`.toUpperCase();
}

export function profileInitials(
  profileName?: string | null,
  displayName?: string | null,
  email?: string | null,
): string {
  const profileParts = nameParts(profileName);
  const displayParts = nameParts(displayName);
  const profileIsPlaceholder =
    profileParts.length === 1 && profileParts[0].toLowerCase() === "athlete";

  if (!profileIsPlaceholder && profileParts.length > 1) {
    return initialsFromParts(profileParts);
  }
  if (
    !profileIsPlaceholder &&
    profileParts.length === 1 &&
    displayParts.length > 1 &&
    displayParts[0].toLocaleLowerCase().startsWith(profileParts[0].toLocaleLowerCase())
  ) {
    return initialsFromParts(displayParts);
  }
  if (!profileIsPlaceholder && profileParts.length) {
    return initialsFromParts(profileParts);
  }
  if (displayParts.length) return initialsFromParts(displayParts);

  const emailLocalPart = (email ?? "").trim().split("@", 1)[0] ?? "";
  const emailParts = emailLocalPart.split(/[._+-]+/).filter(Boolean);
  return initialsFromParts(emailParts) || "?";
}
