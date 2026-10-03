import { getPhoneticsAudio } from "./audio";
import type { PhoneticsSection } from "./hsk1-3-0";
export const lesson3PhoneticsAudio = {
	1: getPhoneticsAudio("hsk1_3-0_lesson3_section1_initials.mp3"),
	2: getPhoneticsAudio("hsk1_3-0_lesson3_section2_finals.mp3"),
	3: getPhoneticsAudio("hsk1_3-0_lesson3_section3_tones.mp3")
};
export const hsk1Lesson3Phonetics: PhoneticsSection[] = [
	{
		id: 1,
		title: "听录音，写出听到的声母并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh mẫu nghe được và đọc to.",
		desktopColumns: 4,
		audio: lesson3PhoneticsAudio[1],
		items: [
			{
				id: 1,
				type: "initial",
				given: "ān",
				answer: "s",
				full: "sān",
				audioText: "sān"
			},
			{
				id: 2,
				type: "initial",
				given: "ī",
				answer: "ch",
				full: "chī",
				audioText: "chī"
			},
			{
				id: 3,
				type: "initial",
				given: "ǒu",
				answer: "z",
				full: "zǒu",
				audioText: "zǒu"
			},
			{
				id: 4,
				type: "initial",
				given: "ěng",
				answer: "zh",
				full: "zhěng",
				audioText: "zhěng"
			},
			{
				id: 5,
				type: "initial",
				given: "ì",
				answer: "z",
				full: "zì",
				audioText: "zì"
			},
			{
				id: 6,
				type: "initial",
				given: "àng",
				answer: "ch",
				full: "chàng",
				audioText: "chàng"
			},
			{
				id: 7,
				type: "initial",
				given: "én",
				answer: "r",
				full: "rén",
				audioText: "rén"
			},
			{
				id: 8,
				type: "initial",
				given: "uì",
				answer: "s",
				full: "suì",
				audioText: "suì"
			},
			{
				id: 9,
				type: "initial",
				given: "ài",
				answer: "c",
				full: "cài",
				audioText: "cài"
			},
			{
				id: 10,
				type: "initial",
				given: "uǐ",
				answer: "sh",
				full: "shuǐ",
				audioText: "shuǐ"
			},
			{
				id: 11,
				type: "initial",
				given: "ì",
				answer: "r",
				full: "rì",
				audioText: "rì"
			},
			{
				id: 12,
				type: "initial",
				given: "ōng",
				answer: "zh",
				full: "zhōng",
				audioText: "zhōng"
			}
		]
	},
	{
		id: 2,
		title: "听录音，写出听到的韵母并大声朗读。",
		description: "Nghe ghi âm, viết ra các vận mẫu nghe được và đọc to.",
		desktopColumns: 5,
		audio: lesson3PhoneticsAudio[2],
		items: [
			{
				id: 1,
				type: "final",
				given: "z",
				answer: "ū",
				full: "zū",
				audioText: "zū"
			},
			{
				id: 2,
				type: "final",
				given: "zh",
				answer: "ī",
				full: "zhī",
				audioText: "zhī"
			},
			{
				id: 3,
				type: "final",
				given: "c",
				answer: "ài",
				full: "cài",
				audioText: "cài"
			},
			{
				id: 4,
				type: "final",
				given: "z",
				answer: "ì",
				full: "zì",
				audioText: "zì"
			},
			{
				id: 5,
				type: "final",
				given: "ch",
				answer: "ǎo",
				full: "chǎo",
				audioText: "chǎo"
			},
			{
				id: 6,
				type: "final",
				given: "r",
				answer: "èn",
				full: "rèn",
				audioText: "rèn"
			},
			{
				id: 7,
				type: "final",
				given: "sh",
				answer: "àng",
				full: "shàng",
				audioText: "shàng"
			},
			{
				id: 8,
				type: "final",
				given: "z",
				answer: "ěn",
				full: "zěn",
				audioText: "zěn"
			},
			{
				id: 9,
				type: "final",
				given: "r",
				answer: "ì",
				full: "rì",
				audioText: "rì"
			},
			{
				id: 10,
				type: "final",
				given: "s",
				answer: "ān",
				full: "sān",
				audioText: "sān"
			},
			{
				id: 11,
				type: "final",
				given: "ch",
				answer: "uān",
				full: "chuān",
				audioText: "chuān"
			},
			{
				id: 12,
				type: "final",
				given: "r",
				answer: "è",
				full: "rè",
				audioText: "rè"
			},
			{
				id: 13,
				type: "final",
				given: "zh",
				answer: "uō",
				full: "zhuō",
				audioText: "zhuō"
			},
			{
				id: 14,
				type: "final",
				given: "c",
				answer: "óng",
				full: "cóng",
				audioText: "cóng"
			},
			{
				id: 15,
				type: "final",
				given: "sh",
				answer: "éi",
				full: "shéi",
				audioText: "shéi"
			}
		]
	},
	{
		id: 3,
		title: "听录音，写出听到的声调并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh điệu nghe được và đọc to.",
		desktopColumns: 5,
		audio: lesson3PhoneticsAudio[3],
		items: [
			{
				id: 1,
				type: "tone",
				syllable: "che",
				answerTone: 1,
				full: "chē",
				audioText: "chē"
			},
			{
				id: 2,
				type: "tone",
				syllable: "ren",
				answerTone: 2,
				full: "rén",
				audioText: "rén"
			},
			{
				id: 3,
				type: "tone",
				syllable: "chang",
				answerTone: 4,
				full: "chàng",
				audioText: "chàng"
			},
			{
				id: 4,
				type: "tone",
				syllable: "zao",
				answerTone: 3,
				full: "zǎo",
				audioText: "zǎo"
			},
			{
				id: 5,
				type: "tone",
				syllable: "shou",
				answerTone: 3,
				full: "shǒu",
				audioText: "shǒu"
			},
			{
				id: 6,
				type: "tone",
				syllable: "zhen",
				answerTone: 1,
				full: "zhēn",
				audioText: "zhēn"
			},
			{
				id: 7,
				type: "tone",
				syllable: "sui",
				answerTone: 4,
				full: "suì",
				audioText: "suì"
			},
			{
				id: 8,
				type: "tone",
				syllable: "sheng",
				answerTone: 1,
				full: "shēng",
				audioText: "shēng"
			},
			{
				id: 9,
				type: "tone",
				syllable: "ri",
				answerTone: 4,
				full: "rì",
				audioText: "rì"
			},
			{
				id: 10,
				type: "tone",
				syllable: "zhong",
				answerTone: 1,
				full: "zhōng",
				audioText: "zhōng"
			},
			{
				id: 11,
				type: "tone",
				syllable: "shui",
				answerTone: 3,
				full: "shuǐ",
				audioText: "shuǐ"
			},
			{
				id: 12,
				type: "tone",
				syllable: "zuo",
				answerTone: 4,
				full: "zuò",
				audioText: "zuò"
			},
			{
				id: 13,
				type: "tone",
				syllable: "chuang",
				answerTone: 2,
				full: "chuáng",
				audioText: "chuáng"
			},
			{
				id: 14,
				type: "tone",
				syllable: "shu",
				answerTone: 1,
				full: "shū",
				audioText: "shū"
			},
			{
				id: 15,
				type: "tone",
				syllable: "si",
				answerTone: 4,
				full: "sì",
				audioText: "sì"
			}
		]
	}
];
