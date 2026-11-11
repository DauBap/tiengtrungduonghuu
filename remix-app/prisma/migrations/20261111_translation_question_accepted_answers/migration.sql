ALTER TABLE "TranslationQuestion"
ADD COLUMN "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
