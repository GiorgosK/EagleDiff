<?php
/**
 * Plugin Name: Visual bugs (Elementor benchmark)
 * Description: Adds known visual bugs to the Elementor benchmark site, one per page, for testing visual regression tools. Deactivate to restore the clean site.
 * Version: 1.0.0
 * License: MIT
 *
 * See ../bugs.json for the list. Each bug is scoped to one page by a
 * data-visual-bug attribute on <html>; content bugs change one widget's HTML.
 */

defined('ABSPATH') || exit;

function visual_bugs_current(): ?string {
  static $bug = FALSE;
  if ($bug === FALSE) {
    $bugs = [
      '' => 'e01', 'services' => 'e02', 'about' => 'e03', 'gallery' => 'e04', 'team' => 'e05',
      'pricing' => 'e06', 'faq' => 'e07', 'process' => 'e08', 'contact' => 'e09',
      'testimonials' => 'e10', 'features' => 'e11', 'skills' => 'e12', 'events' => 'e13',
    ];
    $path = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
    $bug = $bugs[$path] ?? NULL;
  }
  return $bug;
}

add_filter('language_attributes', function (string $output): string {
  $bug = visual_bugs_current();
  return $bug ? $output . ' data-visual-bug="' . esc_attr($bug) . '"' : $output;
});

add_action('wp_enqueue_scripts', function (): void {
  wp_enqueue_style('visual-bugs', plugins_url('css/bugs.css', __FILE__), [], '1.0.0');
}, 100);

// Replaces the n-th <img> in a widget's HTML (1-based).
function visual_bugs_nth_image(string $html, int $n, string $src): string {
  $count = 0;
  return preg_replace_callback('/<img\b[^>]*>/', function ($match) use (&$count, $n, $src) {
    if (++$count !== $n) {
      return $match[0];
    }
    $image = preg_replace('/\s(srcset|sizes)="[^"]*"/', '', $match[0]);
    return preg_replace('/\ssrc="[^"]*"/', ' src="' . esc_url($src) . '"', $image);
  }, $html);
}

add_filter('elementor/widget/render_content', function (string $content, $widget): string {
  $bug = visual_bugs_current();
  $type = $widget->get_name();
  // e03: the first counter counts to 1,020 instead of 1,200.
  if ($bug === 'e03' && $type === 'counter') {
    return str_replace('data-to-value="1200"', 'data-to-value="1020"', $content);
  }
  // e04: the second carousel slide shows another image.
  if ($bug === 'e04' && $type === 'image-carousel') {
    $other = get_page_by_path('man-in-hat', OBJECT, 'attachment');
    return visual_bugs_nth_image($content, 2, wp_get_attachment_image_url($other->ID, 'medium'));
  }
  // e05: the second team photo points to a file that does not exist (HTTP 404).
  if ($bug === 'e05' && $type === 'image-box') {
    static $boxes = 0;
    return ++$boxes === 2 ? visual_bugs_nth_image($content, 1, content_url('uploads/visual-bugs-missing.webp')) : $content;
  }
  // e07: a one-letter typo in the first accordion title.
  if ($bug === 'e07' && $type === 'accordion') {
    return str_replace('Shipping plants', 'Shiping plants', $content);
  }
  // e12: the first progress bar shows 75% instead of 80%.
  if ($bug === 'e12' && $type === 'progress') {
    static $bars = 0;
    return ++$bars === 1 ? str_replace(['data-max="80"', 'aria-valuenow="80"', '>80%<'], ['data-max="75"', 'aria-valuenow="75"', '>75%<'], $content) : $content;
  }
  return $content;
}, 10, 2);
