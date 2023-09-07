import { useNostrEvents, type Metadata } from "nostr-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getReceivedMessages,
  getSentMessages,
  getKeyFromTags,
  descCreatedAt,
  toHexKey,
  getPublicHexKey,
  maybeGetExistingPublicKey,
  dataToProfile,
} from "components/apps/Messenger/functions";
import type { NIP05Result } from "nostr-tools/lib/nip05";
import type {
  NostrProfile,
  NostrContacts,
} from "components/apps/Messenger/types";
import { useProcesses } from "contexts/process";
import directory from "contexts/process/directory";
import { NOTIFICATION_SOUND } from "components/apps/Messenger/constants";
import { MILLISECONDS_IN_MINUTE } from "utils/constants";

const cachedNostrProfiles: Record<string, NostrProfile | undefined> = {};

const PROFILE_CACHE_TIMEOUT_MINUTES = 60;

export const useNostrProfile = (publicKey: string): NostrProfile => {
  const cachedProfile = useMemo(
    () => cachedNostrProfiles[publicKey],
    [publicKey]
  );
  const [profile, setProfile] = useState<NostrProfile>({} as NostrProfile);
  const { onEvent } = useNostrEvents({
    enabled: !cachedProfile,
    filter: {
      authors: [publicKey],
      kinds: [0],
    },
  });

  useEffect(
    () => setProfile(cachedProfile || dataToProfile(publicKey)),
    [cachedProfile, publicKey]
  );

  onEvent(({ content }) => {
    try {
      const metadata = JSON.parse(content) as Metadata;

      if (metadata) {
        const data = dataToProfile(publicKey, metadata);

        setProfile(data);

        cachedNostrProfiles[publicKey] = data;
        window.setTimeout(() => {
          cachedNostrProfiles[publicKey] = undefined;
        }, MILLISECONDS_IN_MINUTE * PROFILE_CACHE_TIMEOUT_MINUTES);
      }
    } catch {
      // Ignore errors parsing profile data
    }
  });

  return cachedProfile || profile;
};

export const useNip05 = (): NIP05Result => {
  const [nip05, setNip05] = useState<NIP05Result>();
  const updateNip05 = useCallback(async (url: string): Promise<boolean> => {
    const nostrJson = await fetch(url);

    if (nostrJson.ok) {
      const { names = {}, relays = {} } =
        ((await nostrJson.json()) as NIP05Result) || {};

      setNip05({ names, relays });
    }

    return nostrJson.ok;
  }, []);
  const fetchNip05Json = useCallback(
    async (): Promise<boolean> =>
      (await updateNip05("/.well-known/nostr.json")) ||
      updateNip05("/nostr.json"),
    [updateNip05]
  );

  useEffect(() => {
    if (!nip05) fetchNip05Json();
  }, [fetchNip05Json, nip05]);

  return nip05 || ({} as NIP05Result);
};

export const useNostrContacts = (
  publicKey: string,
  wellKnownNames: Record<string, string>,
  loginTime: number,
  seenEventIds: string[]
): NostrContacts => {
  const globalContacts = useMemo(
    () => Object.values(wellKnownNames).map((key) => toHexKey(key)),
    [wellKnownNames]
  );
  const receivedEvents = useNostrEvents(getReceivedMessages(publicKey));
  const sentEvents = useNostrEvents(getSentMessages(publicKey));
  const events = useMemo(
    () => [...receivedEvents.events, ...sentEvents.events],
    [receivedEvents, sentEvents]
  );
  const contactKeys = useMemo(() => {
    const keys = new Set(
      events
        .map(({ pubkey, tags }) =>
          pubkey === publicKey ? getKeyFromTags(tags) || "" : pubkey
        )
        .filter((pubkey) => !globalContacts.includes(pubkey))
    );

    return [...globalContacts, ...keys].filter((key) => key !== publicKey);
  }, [events, globalContacts, publicKey]);
  const lastEvents = useMemo(
    () =>
      Object.fromEntries(
        contactKeys.map((pubkey) => [
          pubkey,
          events
            .filter((event) =>
              [event.pubkey, getKeyFromTags(event.tags)].includes(pubkey)
            )
            .sort(descCreatedAt)[0],
        ])
      ),
    [contactKeys, events]
  );
  const unreadEvents = useMemo(
    () =>
      events.filter(
        ({ created_at, id, pubkey }) =>
          pubkey !== publicKey &&
          created_at > loginTime &&
          !seenEventIds.includes(id)
      ),
    [events, loginTime, publicKey, seenEventIds]
  );

  return { contactKeys, events, lastEvents, unreadEvents };
};

export const usePublicKey = (): string => {
  const [publicKey, setPublicKey] = useState<string>("");

  useEffect(() => {
    maybeGetExistingPublicKey().then(getPublicHexKey).then(setPublicKey);
  }, []);

  return publicKey;
};

export const useUnreadStatus = (id: string, unreadCount: number): void => {
  const [currentUnreadCount, setCurrentUnreadCount] = useState(unreadCount);
  const { title } = useProcesses();

  useEffect(() => {
    title(
      id,
      `${directory[id]?.title}${unreadCount > 0 ? ` (${unreadCount})` : ""}`
    );
  }, [id, title, unreadCount]);

  useEffect(() => {
    if (unreadCount > currentUnreadCount) {
      new Audio(NOTIFICATION_SOUND).play();
    }

    setCurrentUnreadCount(unreadCount);
  }, [currentUnreadCount, unreadCount]);
};