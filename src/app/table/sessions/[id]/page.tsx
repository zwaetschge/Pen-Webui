import { PlaySessionRoom } from "../../../play/_components/PlaySessionRoom";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TableSessionPage({ params }: Props) {
  const { id } = await params;
  return <PlaySessionRoom sessionId={id} />;
}
