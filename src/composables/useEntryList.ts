import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player";
import { capabilities } from "@/capabilities";
import type { MediaEntry } from "@shared/types";

/**
 * 收藏 / 历史 / 回收站三个页面的共用逻辑：
 * 拉取一个独立列表，加载缩略图，音频点播、其它类型交系统打开。
 */
export function useEntryList(fetcher: () => Promise<MediaEntry[]>) {
  const items = ref<MediaEntry[]>([]);
  const loading = ref(true);
  const library = useLibraryStore();
  const player = usePlayerStore();
  const router = useRouter();

  async function load() {
    loading.value = true;
    try {
      items.value = await fetcher();
      void library.loadThumbnails(items.value.slice(0, 120).map((i) => i.id));
    } catch {
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);

  /** 音频进播放器，其余交系统默认应用 */
  async function open(item: MediaEntry, index: number) {
    if (item.type === "audio") {
      const audioOnly = items.value.filter((i) => i.type === "audio");
      const pos = audioOnly.findIndex((i) => i.id === item.id);
      player.setQueue(audioOnly, Math.max(pos, 0));
      await player.loadById(item.id);
      router.push("/music/player");
      return;
    }
    void index;
    void capabilities.openFile(item.path);
  }

  async function toggleFavorite(item: MediaEntry) {
    await library.toggleFavorite(item);
    await load();
  }

  return { items, loading, load, open, toggleFavorite };
}
