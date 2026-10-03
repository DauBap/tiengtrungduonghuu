import { hsk1Lesson3Phonetics } from "./hsk1-3-0-lesson3";
import { hsk1Lesson2Phonetics } from "./hsk1-3-0-lesson2";
import { getPhoneticsAudio } from "./audio";
export type Tone = 1 | 2 | 3 | 4;
export type PhoneticsExercise = { id: number; full: string; audioText: string } & (
	| { type: "initial" | "final"; given: string; answer: string }
	| { type: "tone"; syllable: string; answerTone: Tone }
);
export interface PhoneticsSection {
	desktopColumns?: 3 | 4 | 5;
	id: number;
	title: string;
	description: string;
	audio: string | null;
	items: PhoneticsExercise[];
}
export const lesson1PhoneticsAudio = {
	1: null,
	2: getPhoneticsAudio("hsk1_3-0_lesson1_section2_initials.mp3"),
	3: getPhoneticsAudio("hsk1_3-0_lesson1_section3_finals.mp3"),
	4: getPhoneticsAudio("hsk1_3-0_lesson1_section4_tones.mp3")
};
export function normalizeFinal(value: string) {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300\u0301\u0304\u030c]/g, "")
		.normalize("NFC");
}
export function withTone(syllable: string, tone: Tone): string {
	const index = syllable.includes("a")
		? syllable.indexOf("a")
		: syllable.includes("e")
			? syllable.indexOf("e")
			: syllable.includes("ou")
				? syllable.indexOf("o")
				: Math.max(...[...syllable].map((letter, i) => ("iouü".includes(letter) ? i : -1)));
	const marks: Record<string, string> = {
		a: "āáǎà",
		e: "ēéěè",
		i: "īíǐì",
		o: "ōóǒò",
		u: "ūúǔù",
		ü: "ǖǘǚǜ"
	};
	return index < 0
		? syllable
		: syllable.slice(0, index) + marks[syllable[index]][tone - 1] + syllable.slice(index + 1);
}
export function isCorrect(item: PhoneticsExercise, value: string | number | undefined) {
	if (item.type === "tone") return value === item.answerTone;
	if (typeof value !== "string") return false;
	return item.type === "final"
		? normalizeFinal(value) === normalizeFinal(item.answer)
		: value.trim().toLowerCase() === item.answer;
}
function blanks(type: "initial" | "final", rows: string[]): PhoneticsExercise[] {
	return rows.map((row, index) => {
		const [given, answer, full] = row.split("|");
		return { id: index + 1, type, given, answer, full, audioText: full };
	});
}
export const hsk1Lesson1Phonetics: PhoneticsSection[] = [
	{
		id: 2,
		title: "听录音，写出听到的声母并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh mẫu nghe được và đọc to.",
		audio: lesson1PhoneticsAudio[2],
		items: blanks("initial", [
			"à|d|dà",
			"ěi|g|gěi",
			"án|p|pán",
			"ù|b|bù",
			"ǎi|m|mǎi",
			"ěng|l|lěng",
			"ó|f|fó",
			"ǎo|h|hǎo",
			"óng|t|tóng",
			"èn|h|hèn",
			"ān|b|bān",
			"ōu|d|dōu",
			"è|k|kè",
			"ǐ|n|nǐ",
			"áng|m|máng"
		])
	},
	{
		id: 3,
		title: "听录音，写出听到的韵母并大声朗读。",
		description: "Nghe ghi âm, viết ra các vận mẫu nghe được và đọc to.",
		audio: lesson1PhoneticsAudio[3],
		items: blanks("final", [
			"t|ā|tā",
			"h|èn|hèn",
			"m|āo|māo",
			"d|ì|dì",
			"f|áng|fáng",
			"d|ōng|dōng",
			"h|àn|hàn",
			"g|ǒu|gǒu",
			"p|éng|péng",
			"g|ē|gē",
			"k|āi|kāi",
			"f|ēi|fēi",
			"n|ù|nù",
			"l|ěng|lěng",
			"b|ō|bō"
		])
	},
	{
		id: 4,
		title: "听录音，写出听到的声调并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh điệu nghe được và đọc to.",
		audio: lesson1PhoneticsAudio[4],
		items: [
			"lao|3|lǎo",
			"neng|2|néng",
			"ge|4|gè",
			"ba|1|bā",
			"fen|1|fēn",
			"kan|4|kàn",
			"bai|2|bái",
			"li|3|lǐ",
			"gong|1|gōng",
			"mang|2|máng",
			"gou|3|gǒu",
			"hou|4|hòu"
		].map((row, index) => {
			const [syllable, tone, full] = row.split("|");
			return {
				id: index + 1,
				type: "tone",
				syllable,
				answerTone: Number(tone) as Tone,
				full,
				audioText: full
			};
		})
	}
];
export function getPhonetics(courseId: string, lessonId: number): PhoneticsSection[] | undefined {
	if (courseId.toLowerCase() !== "hsk1_3-0") return undefined;
	return (
		{ 1: hsk1Lesson1Phonetics, 2: hsk1Lesson2Phonetics, 3: hsk1Lesson3Phonetics } as Record<
			number,
			PhoneticsSection[]
		>
	)[lessonId];
}
