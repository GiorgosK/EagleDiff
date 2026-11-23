<script>
	import PageHeader from "$lib/benchmark/PageHeader.svelte";
	import Reveal from "$lib/benchmark/Reveal.svelte";
	import Footer from "$lib/components/Footer.svelte";
</script>

<div class="bg-[#050505] text-white">
	<PageHeader eyebrow="Contact" title="Start a" accent="project." intro="Tell us about your idea. We answer every message within two working days." />
	<section class="contact px-6 md:px-24 py-24 max-w-3xl mx-auto">
		<Reveal>
			<form class="contact-form flex flex-col gap-8" onsubmit={(event) => event.preventDefault()}>
				<label class="flex flex-col gap-3">
					<span class="text-xs font-mono text-white/40 uppercase tracking-widest">Name</span>
					<input name="name" class="contact-field bg-transparent border border-white/20 rounded-xl px-5 py-4 text-white" />
				</label>
				<label class="flex flex-col gap-3">
					<span class="text-xs font-mono text-white/40 uppercase tracking-widest">E-mail</span>
					<input name="email" type="email" class="contact-field contact-email bg-transparent border border-white/20 rounded-xl px-5 py-4 text-white" />
				</label>
				<label class="flex flex-col gap-3">
					<span class="text-xs font-mono text-white/40 uppercase tracking-widest">Project</span>
					<textarea name="project" rows="5" class="contact-field bg-transparent border border-white/20 rounded-xl px-5 py-4 text-white"></textarea>
				</label>
				<button class="self-start px-8 py-4 bg-white text-black rounded-full font-sans font-medium">Send message</button>
			</form>
		</Reveal>
	</section>
	<Footer />
</div>
