export interface ListeningGrade {
  points: string;
  message: string;
}

export function getListeningGrade(scorePercent: number | null): ListeningGrade | null {
  if (scorePercent === null || !Number.isFinite(scorePercent)) return null;

  const boundedPercent = Math.max(0, Math.min(100, scorePercent));
  const points = (boundedPercent / 10).toFixed(1);
  const message = boundedPercent < 50
    ? "Chưa tốt lắm"
    : boundedPercent < 80
      ? "Khá, cố gắng lên!"
      : boundedPercent < 100
        ? "Ôi giỏi quá, gần đạt rồi!"
        : "Chúc mừng bạn, quá tuyệt vời!";

  return { points, message };
}
