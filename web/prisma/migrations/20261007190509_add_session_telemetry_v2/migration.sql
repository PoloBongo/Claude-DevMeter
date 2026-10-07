-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "apiErrorCount" INTEGER,
ADD COLUMN     "claudeCodeVersion" TEXT,
ADD COLUMN     "claudeMdHash" TEXT,
ADD COLUMN     "claudeMdLines" INTEGER,
ADD COLUMN     "compactionCount" INTEGER,
ADD COLUMN     "effort" TEXT,
ADD COLUMN     "peakContextTokens" INTEGER,
ADD COLUMN     "planModeCount" INTEGER,
ADD COLUMN     "skillActivations" INTEGER,
ADD COLUMN     "subagentRuns" INTEGER,
ADD COLUMN     "surveyResponse" TEXT,
ADD COLUMN     "tag" TEXT;
