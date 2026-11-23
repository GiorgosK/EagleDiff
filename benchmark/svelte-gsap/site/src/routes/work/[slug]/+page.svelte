<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Reveal from "$lib/benchmark/Reveal.svelte";
	import Footer from "$lib/components/Footer.svelte";

	let { data } = $props();
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="{data.work.category}, {data.work.year}" title={data.work.name} intro={data.work.intro} />
	<section class="project px-6 md:px-24 py-24 max-w-7xl mx-auto">
		<Reveal className="project-cover overflow-hidden rounded-2xl border border-white/10">
			<img src="/og-image.png" alt="{data.work.name} preview" class="w-full block" width="1200" height="630" />
		</Reveal>
		<div class="project-body grid md:grid-cols-2 gap-12 mt-24">
			{#each data.work.body as paragraph}
				<Reveal><p class="text-xl md:text-2xl text-white/60 font-sans font-light leading-relaxed">{paragraph}</p></Reveal>
			{/each}
		</div>
		<a href="/work/{data.next.slug}" class="next-project block border-t border-white/10 mt-32 pt-12">
			<span class="text-xs font-mono text-white/30 uppercase tracking-widest">Next project</span>
			<span class="block text-5xl md:text-7xl font-serif tracking-tight mt-4">{data.next.name}</span>
		</a>
	</section>
	<Footer />
</div>
