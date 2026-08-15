<script setup lang="ts">
/**
 * 封面图组件：优先从本地缓存（IndexedDB dataURL）加载，未命中时网络获取并写缓存。
 * 传 alt 覆盖默认；保留 loading="lazy" / decoding="async"。
 */
import { ref, watch } from "vue";
import { resolveCover } from "@/utils/onlineCache";

const props = withDefaults(
  defineProps<{ url?: string; alt?: string }>(),
  { url: "", alt: "" },
);

const src = ref("");
let token = 0;
watch(
  () => props.url,
  (url) => {
    const myToken = ++token;
    if (!url) {
      src.value = "";
      return;
    }
    void resolveCover(url).then((r) => {
      if (myToken === token) src.value = r;
    });
  },
  { immediate: true },
);
</script>

<template>
  <img :src="src" :alt="alt" loading="lazy" decoding="async" />
</template>
