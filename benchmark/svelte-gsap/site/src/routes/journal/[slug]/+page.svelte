<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Reveal from "$lib/benchmark/Reveal.svelte";
	import Footer from "$lib/components/Footer.svelte";

	let { data } = $props();
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow={data.post.date} title={data.post.title} intro={data.post.lead} />
	<article class="post px-6 md:px-24 py-24 max-w-3xl mx-auto flex flex-col gap-10">
		{#each data.post.body as paragraph}
			<Reveal><p class="post-text text-xl md:text-2xl text-white/70 font-sans font-light leading-relaxed">{paragraph}</p></Reveal>
		{/each}
		<a href="/journal" class="text-xs font-mono text-white/40 uppercase tracking-widest mt-12">Back to the journal</a>
	</article>
	<Footer />
</div>
