import { PlaySessionRoom } from "../../../../_components/PlaySessionRoom";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string; id: string }>;
};

export default async function PlayInviteSessionPage({ params }: Props) {
  const { token, id } = await params;
  return <PlaySessionRoom sessionId={id} inviteToken={token} />;
}
