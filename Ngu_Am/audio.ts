const audioFiles = import.meta.glob("/src/lib/data/Ngu_Am/audio/*.mp3", {
	eager: true,
	query: "?url",
	import: "default"
}) as Record<string, string>;

export function getPhoneticsAudio(fileName: string): string | null {
	return audioFiles[`/src/lib/data/Ngu_Am/audio/${fileName}`] ?? null;
}