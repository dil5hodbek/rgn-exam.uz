import { ExamRunner } from "@/components/exam/exam-runner";
export default function AttemptPage({ params, searchParams }: { params: { level: string; examType: string; variant: string }; searchParams: { attempt?: string } }) {
  return <ExamRunner initialAttemptId={searchParams.attempt} testId={params.variant} resultBasePath={`/dashboard/${params.level}/${params.examType}/${params.variant}/result`} />;
}
