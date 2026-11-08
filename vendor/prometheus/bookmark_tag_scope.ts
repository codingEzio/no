/** Tag names are stored in full. The NSFW prefix is a visibility marker. */
export function isNsfwTagName(name: string): boolean {
  return name.trim().normalize("NFC").toLowerCase().startsWith("nsfw");
}

export function bookmarkTagLabel(name: string): string {
  return isNsfwTagName(name)
    ? name.trim().replace(/^nsfw[-_\s:：]*/iu, "") || "NSFW"
    : name;
}
