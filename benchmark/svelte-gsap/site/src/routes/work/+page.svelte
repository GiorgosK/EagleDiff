<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Reveal from "$lib/benchmark/Reveal.svelte";
	import Brands from "$lib/components/Brands.svelte";
	import Footer from "$lib/components/Footer.svelte";
	import { works } from "$lib/benchmark/content.js";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Work" title="Selected" accent="works." intro="Four projects from the last three years." />
	<section class="work-index px-6 md:px-24 py-24 max-w-7xl mx-auto">
		{#each works as work, i}
			<Reveal className="work-row border-t border-white/10 py-10">
				<a href="/work/{work.slug}" class="flex flex-col md:flex-row md:items-baseline justify-between gap-4">
					<span class="font-mono text-white/30 text-sm">0{i + 1}</span>
					<span class="text-4xl md:text-6xl font-serif tracking-tight flex-1 md:px-12">{work.name}</span>
					<span class="text-white/40 font-sans">{work.category}, {work.year}</span>
				</a>
			</Reveal>
		{/each}
	</section>
	<Brands />
	<Footer />
</div>
