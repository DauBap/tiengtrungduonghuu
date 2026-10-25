import { getPhoneticsAudio } from "./audio";
import type { PhoneticsSection } from "./hsk1-3-0";
export const lesson2PhoneticsAudio = {
	1: getPhoneticsAudio("hsk1_3-0_lesson2_section1_initials.mp3"),
	2: getPhoneticsAudio("hsk1_3-0_lesson2_section2_finals.mp3"),
	3: getPhoneticsAudio("hsk1_3-0_lesson2_section3_tones.mp3")
};
export const hsk1Lesson2Phonetics: PhoneticsSection[] = [
	{
		id: 1,
		title: "听录音，写出听到的声母并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh mẫu nghe được và đọc to.",
		desktopColumns: 3,
		audio: lesson2PhoneticsAudio[1],
		items: [
			{
				id: 1,
				type: "initial",
				given: "ián",
				answer: "q",
				full: "qián",
				audioText: "qián"
			},
			{
				id: 2,
				type: "initial",
				given: "īn",
				answer: "j",
				full: "jīn",
				audioText: "jīn"
			},
			{
				id: 3,
				type: "initial",
				given: "iǎng",
				answer: "x",
				full: "xiǎng",
				audioText: "xiǎng"
			},
			{
				id: 4,
				type: "initial",
				given: "iào",
				answer: "j",
				full: "jiào",
				audioText: "jiào"
			},
			{
				id: 5,
				type: "initial",
				given: "iè",
				answer: "x",
				full: "xiè",
				audioText: "xiè"
			},
			{
				id: 6,
				type: "initial",
				given: "ǐng",
				answer: "q",
				full: "qǐng",
				audioText: "qǐng"
			},
			{
				id: 7,
				type: "initial",
				given: "ǐ",
				answer: "j",
				full: "jǐ",
				audioText: "jǐ"
			},
			{
				id: 8,
				type: "initial",
				given: "ù",
				answer: "q",
				full: "qù",
				audioText: "qù"
			},
			{
				id: 9,
				type: "initial",
				given: "ià",
				answer: "x",
				full: "xià",
				audioText: "xià"
			}
		]
	},
	{
		id: 2,
		title: "听录音，写出听到的韵母并大声朗读。",
		description: "Nghe ghi âm, viết ra các vận mẫu nghe được và đọc to.",
		desktopColumns: 5,
		audio: lesson2PhoneticsAudio[2],
		items: [
			{
				id: 1,
				type: "final",
				given: "j",
				answer: "iǎn",
				full: "jiǎn",
				audioText: "jiǎn"
			},
			{
				id: 2,
				type: "final",
				given: "x",
				answer: "iě",
				full: "xiě",
				audioText: "xiě"
			},
			{
				id: 3,
				type: "final",
				given: "q",
				answer: "ù",
				full: "qù",
				audioText: "qù"
			},
			{
				id: 4,
				type: "final",
				given: "j",
				answer: "iào",
				full: "jiào",
				audioText: "jiào"
			},
			{
				id: 5,
				type: "final",
				given: "q",
				answer: "ǐng",
				full: "qǐng",
				audioText: "qǐng"
			},
			{
				id: 6,
				type: "final",
				given: "x",
				answer: "ué",
				full: "xué",
				audioText: "xué"
			},
			{
				id: 7,
				type: "final",
				given: "j",
				answer: "iǎo",
				full: "jiǎo",
				audioText: "jiǎo"
			},
			{
				id: 8,
				type: "final",
				given: "x",
				answer: "īng",
				full: "xīng",
				audioText: "xīng"
			},
			{
				id: 9,
				type: "final",
				given: "j",
				answer: "iě",
				full: "jiě",
				audioText: "jiě"
			},
			{
				id: 10,
				type: "final",
				given: "q",
				answer: "ián",
				full: "qián",
				audioText: "qián"
			},
			{
				id: 11,
				type: "final",
				given: "x",
				answer: "iàn",
				full: "xiàn",
				audioText: "xiàn"
			},
			{
				id: 12,
				type: "final",
				given: "q",
				answer: "ǐ",
				full: "qǐ",
				audioText: "qǐ"
			},
			{
				id: 13,
				type: "final",
				given: "j",
				answer: "iā",
				full: "jiā",
				audioText: "jiā"
			},
			{
				id: 14,
				type: "final",
				given: "x",
				answer: "iū",
				full: "xiū",
				audioText: "xiū"
			},
			{
				id: 15,
				type: "final",
				given: "q",
				answer: "uán",
				full: "quán",
				audioText: "quán"
			}
		]
	},
	{
		id: 3,
		title: "听录音，写出听到的声调并大声朗读。",
		description: "Nghe ghi âm, viết ra các thanh điệu nghe được và đọc to.",
		desktopColumns: 4,
		audio: lesson2PhoneticsAudio[3],
		items: [
			{
				id: 1,
				type: "tone",
				syllable: "xue",
				answerTone: 2,
				full: "xué",
				audioText: "xué"
			},
			{
				id: 2,
				type: "tone",
				syllable: "jiao",
				answerTone: 4,
				full: "jiào",
				audioText: "jiào"
			},
			{
				id: 3,
				type: "tone",
				syllable: "qun",
				answerTone: 2,
				full: "qún",
				audioText: "qún"
			},
			{
				id: 4,
				type: "tone",
				syllable: "jiu",
				answerTone: 3,
				full: "jiǔ",
				audioText: "jiǔ"
			},
			{
				id: 5,
				type: "tone",
				syllable: "xin",
				answerTone: 1,
				full: "xīn",
				audioText: "xīn"
			},
			{
				id: 6,
				type: "tone",
				syllable: "qing",
				answerTone: 3,
				full: "qǐng",
				audioText: "qǐng"
			},
			{
				id: 7,
				type: "tone",
				syllable: "xia",
				answerTone: 4,
				full: "xià",
				audioText: "xià"
			},
			{
				id: 8,
				type: "tone",
				syllable: "jia",
				answerTone: 1,
				full: "jiā",
				audioText: "jiā"
			},
			{
				id: 9,
				type: "tone",
				syllable: "qu",
				answerTone: 4,
				full: "qù",
				audioText: "qù"
			},
			{
				id: 10,
				type: "tone",
				syllable: "ji",
				answerTone: 1,
				full: "jī",
				audioText: "jī"
			},
			{
				id: 11,
				type: "tone",
				syllable: "xiao",
				answerTone: 3,
				full: "xiǎo",
				audioText: "xiǎo"
			},
			{
				id: 12,
				type: "tone",
				syllable: "jie",
				answerTone: 3,
				full: "jiě",
				audioText: "jiě"
			}
		]
	}
];
