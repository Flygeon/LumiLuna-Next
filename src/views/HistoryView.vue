<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="simple-view">
    <div class="empty">
      <div class="empty-icon"><span class="material-symbols-outlined">history</span></div>
      <p>{{ t("nav.history") }}</p>
    </div>
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  margin-top: 80px;
  color: var(--md-sys-color-on-surface-variant);
}
.empty-icon {
  font-size: 60px;
  margin-bottom: 16px;
}
.empty-icon .material-symbols-outlined {
  font-size: 60px;
}
</style>
