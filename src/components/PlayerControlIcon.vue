<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Apple Music 风格传输控制图标：play / pause */
    name: "play" | "pause";
  }>(),
  { name: "play" },
);
</script>

<template>
  <svg class="player-control-icon" viewBox="0 0 32 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      v-if="name === 'play'"
      d="M10.345 23.287c.415 0 .763-.15 1.22-.407l12.742-7.404c.838-.481 1.178-.855 1.178-1.46 0-.599-.34-.972-1.178-1.462L11.565 5.158c-.457-.265-.805-.407-1.22-.407-.789 0-1.345.606-1.345 1.57V21.71c0 .971.556 1.577 1.345 1.577z"
      fill="currentColor"
      fill-rule="nonzero"
    />
    <path
      v-else
      d="M13.293 22.772c.955 0 1.436-.481 1.436-1.436V6.677c0-.98-.481-1.427-1.436-1.427h-2.457c-.954 0-1.436.473-1.436 1.427v14.66c-.008.954.473 1.435 1.436 1.435h2.457zm7.87 0c.954 0 1.427-.481 1.427-1.436V6.677c0-.98-.473-1.427-1.428-1.427h-2.465c-.955 0-1.428.473-1.428 1.427v14.66c0 .954.473 1.435 1.428 1.435h2.465z"
      fill="currentColor"
      fill-rule="nonzero"
    />
  </svg>
</template>

<style scoped>
.player-control-icon {
  display: block;
  width: 1em;
  height: 1em;
}
</style>