import { TestBuilder } from "@/components/admin/test-builder";
export default function EditTest({ params }: { params: { variantId: string } }) { return <TestBuilder variantId={params.variantId} />; }
