import { PlaySessionRoom } from "../../_components/PlaySessionRoom";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function PlaySessionPage({ params }: Props) {
  const { id } = await params;
  return <PlaySessionRoom sessionId={id} />;
}
