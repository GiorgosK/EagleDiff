<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Reveal from "$lib/benchmark/Reveal.svelte";
	import Footer from "$lib/components/Footer.svelte";
	import { posts } from "$lib/benchmark/content.js";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Journal" title="Notes from" accent="the studio." />
	<section class="journal px-6 md:px-24 py-24 max-w-7xl mx-auto grid md:grid-cols-2 gap-8">
		{#each posts as post}
			<Reveal className="journal-card border border-white/10 rounded-2xl p-10">
				<a href="/journal/{post.slug}" class="flex flex-col gap-6">
					<span class="text-xs font-mono text-white/30 uppercase tracking-widest">{post.date}</span>
					<span class="text-3xl md:text-4xl font-serif tracking-tight">{post.title}</span>
					<span class="text-white/50 font-sans font-light leading-relaxed">{post.lead}</span>
				</a>
			</Reveal>
		{/each}
	</section>
	<Footer />
</div>
