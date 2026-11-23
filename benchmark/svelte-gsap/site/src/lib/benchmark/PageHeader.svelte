<script>
	import { onMount } from "svelte";
	import gsap from "gsap";

	let { eyebrow, title, accent = "", intro = "" } = $props();
	let titleRef = $state();
	let introRef = $state();

	onMount(() => {
		gsap.from(titleRef, { yPercent: 40, autoAlpha: 0, duration: 1.4, ease: "expo.out", delay: 0.1 });
		if (introRef) gsap.from(introRef, { y: 20, autoAlpha: 0, duration: 1.2, ease: "power3.out", delay: 0.4 });
	});
</script>

<section class="page-header w-full bg-[#050505] text-white pt-48 pb-24 px-6 md:px-24 border-b border-white/5">
	<div class="max-w-7xl mx-auto">
		<span class="page-eyebrow text-xs font-mono text-white/30 uppercase tracking-widest mb-8 block">{eyebrow}</span>
		<div class="overflow-hidden">
			<h1 bind:this={titleRef} class="page-title text-6xl md:text-8xl font-serif tracking-tight leading-[0.95]">
				{title}{#if accent}<br /><span class="italic text-white/40">{accent}</span>{/if}
			</h1>
		</div>
		{#if intro}
			<p bind:this={introRef} class="page-intro text-lg md:text-2xl text-white/50 max-w-3xl mt-10 font-sans font-light leading-relaxed">{intro}</p>
		{/if}
	</div>
</section>
