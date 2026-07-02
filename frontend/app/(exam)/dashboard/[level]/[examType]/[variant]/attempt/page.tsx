import { ExamRunner } from "@/components/exam/exam-runner";
export default function AttemptPage({ params }: { params: { level: string; examType: string; variant: string } }) {
  return <ExamRunner testId={params.variant} resultBasePath={`/dashboard/${params.level}/${params.examType}/${params.variant}/result`} />;
}
